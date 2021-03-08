import Automerge from "automerge/src/automerge"
import jssha from "jssha/src/sha256"

import { b64ToBytes, bytesToB64 } from "../../util/src/b64"
import { cleanPath } from "../../util/src/path"
import { CryptoMiddleware, NetworkMiddleware } from "../../middleware/src/middleware"
import { DAG, DAGVertex } from "./dag"
import { getPayload } from "../../util/src/payload"
import { readUInt32BE, uint32ToUint8BE } from "../../util/src/uint"

const sha256 = (d: Uint8Array): Uint8Array => {
	const digest = new jssha("SHA-256", "UINT8ARRAY")
	digest.update(d)
	return digest.getHash("UINT8ARRAY")
}

type MetadataGetPayload = {
	metadataV2Key: string
}

type MetadataGetRes = {
	metadataV2: string
	expirationDate: number
}

type MetadataAddPayload = {
	metadataV2Key: string
	metadataV2Vertex: string
	metadataV2Edges: string[]
	metadataV2Sig: string
}

type MetadataAddRes = {
	MetadataV2Key: string
	MetadataV2: string
	ExpirationDate: number
}

type MetadataDeletePayload = {
	metadataV2Key: string
}

type MetadataDeleteRes = {
	status: "metadataV2 successfully deleted"
}

export type MetadataAccessConfig = {
	metadataNode: string

	crypto: CryptoMiddleware
	net: NetworkMiddleware
}

const packChanges = (changes: Uint8Array[]): Uint8Array => {
	const len = 4 + 4 * changes.length + changes.reduce((acc, cur) => acc + cur.length, 0)
	const packed = new Uint8Array(len)

	let i = 0

	const lArr = uint32ToUint8BE(changes.length)
	packed[i + 0] = lArr[0]
	packed[i + 1] = lArr[1]
	packed[i + 2] = lArr[2]
	packed[i + 3] = lArr[3]
	i += 4

	for (let change of changes) {
		const lArr2 = uint32ToUint8BE(change.length)
		packed[i + 0] = lArr2[0]
		packed[i + 1] = lArr2[1]
		packed[i + 2] = lArr2[2]
		packed[i + 3] = lArr2[3]
		i += 4

		for (let n = 0; n < change.length; n++) {
			packed[i + n] = change[n]
		}

		i += change.length
	}

	return packed
}

const unpackChanges = (packed: Uint8Array): Uint8Array[] => {
	let i = 0
	const changes: Uint8Array[] = []

	const len = readUInt32BE(packed, i)
	i += 4

	for (let c = 0; c < len; c++) {
		const l = readUInt32BE(packed, i)
		i += 4

		changes.push(packed.slice(i, i + l))
		i += l
	}

	return changes
}

export class MetadataAccess {
	config: MetadataAccessConfig
	dags: { [path: string]: DAG } = {}

	constructor (config: MetadataAccessConfig) {
		this.config = config
	}

	async change<T = unknown> (
		path: string,
		description: string,
		fn: Automerge.ChangeFn<Automerge.Proxy<T>>,
	): Promise<Automerge.Doc<T>> {
		path = cleanPath(path)

		// sync
		const curDoc = (await this.get<T>(path)) || Automerge.init<T>()
		const dag = this.dags[path]

		// change
		const newDoc = Automerge.change(curDoc, description, fn)

		// commit
		const priv = await this.config.crypto.derive(undefined, path)
		const pub = await this.config.crypto.getPublicKey(priv)

		const changes = Automerge.getChanges(curDoc, newDoc)

		const encrypted = await this.config.crypto.encrypt(sha256(priv), packChanges(changes))
		const v = new DAGVertex(encrypted)
		dag.addReduced(v)

		const edges = dag.parentEdges(v.id)

		const payload = await getPayload<MetadataAddPayload>({
			crypto: this.config.crypto,
			payload: {
				metadataV2Key: bytesToB64(pub),
				metadataV2Vertex: bytesToB64(v.binary),
				metadataV2Edges: edges.map((edge) => bytesToB64(edge.binary)),
				metadataV2Sig: bytesToB64(await this.config.crypto.sign(priv, await dag.digest(v.id, sha256))),
			},
		})

		await this.config.net.POST<MetadataAddRes>(
			this.config.metadataNode + "/api/v2/metadata/add",
			undefined,
			JSON.stringify(payload),
			(res) => new Response(res).json(),
		)

		return newDoc
	}

	async get<T> (path: string): Promise<Automerge.Doc<T> | undefined> {
		path = cleanPath(path)

		const priv = await this.config.crypto.derive(undefined, path)
		const pub = await this.config.crypto.getPublicKey(priv)

		const payload = await getPayload<MetadataGetPayload>({
			crypto: this.config.crypto,
			payload: {
				metadataV2Key: bytesToB64(pub),
			},
		})

		const res = await this.config.net.POST<MetadataGetRes>(
			this.config.metadataNode + "/api/v2/metadata/get",
			undefined,
			JSON.stringify(payload),
			(res) => new Response(res).json(),
		)

		if (((res.data as unknown) as string) == "Key not found") {
			const dag = new DAG()
			this.dags[path] = dag

			return undefined
		}

		const dag = DAG.fromBinary(b64ToBytes(res.data.metadataV2))
		this.dags[path] = dag

		const decrypted = await Promise.all(dag.nodes.map(({ data }) => this.config.crypto.decrypt(sha256(priv), data)))
		const changes = decrypted.map((data) => unpackChanges(data)).flat()

		return Automerge.applyChanges(Automerge.init<T>(), changes)
	}

	async delete (path: string): Promise<void> {
		path = cleanPath(path)

		const priv = await this.config.crypto.derive(undefined, path)
		const pub = await this.config.crypto.getPublicKey(priv)

		const payload = await getPayload<MetadataDeletePayload>({
			crypto: this.config.crypto,
			payload: {
				metadataV2Key: bytesToB64(pub),
			},
		})

		await this.config.net.POST<MetadataDeleteRes>(
			this.config.metadataNode + "/api/v2/metadata/delete",
			undefined,
			JSON.stringify(payload),
			(res) => new Response(res).json(),
		)
	}
}
