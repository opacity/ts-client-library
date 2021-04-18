import { Semaphore } from "async-mutex"
import Automerge from "automerge/src/automerge"
import jssha from "jssha/dist/sha256"

import { b64ToBytes, bytesToB64 } from "@opacity/util/src/b64"
import { cleanPath } from "@opacity/util/src/path"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { DAG, DAGVertex } from "./dag"
import { getPayload } from "@opacity/util/src/payload"
import { readUInt32BE, uint32ToUint8BE } from "@opacity/util/src/uint"

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
	isPublic: boolean
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

type MetadataIndex = {
	privs: {
		[location: string]: true
	}
	encryptKeys: {
		[location: string]: string
	}
}

export class MetadataAccess {
	config: MetadataAccessConfig
	dags: { [path: string]: DAG } = {}
	cache: {
		[path: string]: {
			lastAccess: number
			dirty: boolean
			doc: Automerge.Doc<unknown> | undefined
		}
	} = {}

	metadataIndexPath = "/metadata-index"

	_sem: Semaphore = new Semaphore(3)

	constructor (config: MetadataAccessConfig) {
		this.config = config
	}

	async markCacheDirty (path: string) {
		const priv = await this.config.crypto.derive(undefined, path)
		const pub = await this.config.crypto.getPublicKey(priv)

		return this._markCacheDirty(pub)
	}

	_markCacheDirty (pub: Uint8Array) {
		const pubString = bytesToB64(pub)
		const cached = this.cache[pubString]

		if (cached) {
			cached.dirty = true
		}
	}

	async getMetadataLocationKeysList (): Promise<Uint8Array[]> {
		const priv = await this.config.crypto.derive(undefined, this.metadataIndexPath)

		// do not cache
		const metaIndexObject = (await this._get<MetadataIndex>(priv, undefined, true)) || ({} as MetadataIndex)

		const metaIndexPrivs = [bytesToB64(priv)].concat(Object.keys(metaIndexObject.privs))

		const validLocations = (
			await Promise.all(
				metaIndexPrivs.map((privString) => {
					return this._sem.runExclusive(async () => {
						const priv = b64ToBytes(privString)
						const pub = await this.config.crypto.getPublicKey(priv)
						const pubString = bytesToB64(pub)

						const payload = await getPayload<MetadataGetPayload>({
							crypto: this.config.crypto,
							payload: {
								metadataV2Key: pubString,
							},
						})

						const res = await this.config.net.POST<MetadataGetRes>(
							this.config.metadataNode + "/api/v2/metadata/get",
							undefined,
							JSON.stringify(payload),
							(res) => new Response(res).json(),
						)

						if (((res.data as unknown) as string) == "Key not found") {
							return undefined
						}

						return pub
					})
				}),
			)
		).filter(Boolean) as Uint8Array[]

		return validLocations
	}

	async _metadataIndexAdd (priv: Uint8Array, encryptKey: Uint8Array | undefined) {
		const privString = bytesToB64(priv)
		const encryptKeyString = encryptKey ? bytesToB64(encryptKey) : undefined

		const metaIndexPriv = await this.config.crypto.derive(undefined, this.metadataIndexPath)

		// fast check
		const doc = await this._get<MetadataIndex>(metaIndexPriv, undefined, false)
		if (doc && privString in doc.privs) {
			return
		}

		// long set
		await this._change<MetadataIndex>(
			metaIndexPriv,
			undefined,
			(doc) => {
				if (privString in doc) {
					return
				}

				if (!doc.privs) {
					doc.privs = {}
				}
				if (!doc.encryptKeys) {
					doc.encryptKeys = {}
				}

				doc.privs[privString] = true
				if (encryptKeyString) {
					doc.encryptKeys[privString] = encryptKeyString
				}
			},
			false,
			undefined,
			true,
		)
	}

	async _metadataIndexRemove (priv: Uint8Array) {
		const privString = bytesToB64(priv)

		const metaIndexPriv = await this.config.crypto.derive(undefined, this.metadataIndexPath)

		// fast check
		const doc = await this._get<MetadataIndex>(metaIndexPriv, undefined, false)
		if (doc && !(privString in doc.privs)) {
			return
		}

		// long set
		await this._change<MetadataIndex>(
			metaIndexPriv,
			undefined,
			(doc) => {
				if (privString in doc) {
					return
				}

				delete doc.privs[privString]
				delete doc.encryptKeys[privString]
			},
			false,
			undefined,
			true,
		)
	}

	async change<T = unknown> (
		path: string,
		description: string,
		fn: Automerge.ChangeFn<Automerge.Proxy<T>>,
		markCacheDirty = false,
	): Promise<Automerge.Doc<T>> {
		// console.log("change(", path, description, fn, ")")

		path = cleanPath(path)

		const priv = await this.config.crypto.derive(undefined, path)
		await this._metadataIndexAdd(priv, undefined)

		return await this._change<T>(priv, description, fn, false, undefined, markCacheDirty)
	}

	async changePublic<T = unknown> (
		priv: Uint8Array,
		description: string | undefined,
		fn: Automerge.ChangeFn<Automerge.Proxy<T>>,
		encryptKey: Uint8Array,
		markCacheDirty = false,
	): Promise<Automerge.Doc<T>> {
		// console.log("changePublic(", priv, description, fn, encryptKey, ")")

		await this._metadataIndexAdd(priv, encryptKey)

		return await this._change<T>(priv, description, fn, true, encryptKey, markCacheDirty)
	}

	async _change<T = unknown> (
		priv: Uint8Array,
		description: string | undefined,
		fn: Automerge.ChangeFn<Automerge.Proxy<T>>,
		isPublic: boolean,
		encryptKey?: Uint8Array,
		markCacheDirty = false,
	): Promise<Automerge.Doc<T>> {
		// console.log("_change(", priv, description, fn, isPublic, encryptKey, ")")

		const pub = await this.config.crypto.getPublicKey(priv)
		const pubString = bytesToB64(pub)

		// sync
		const curDoc = (await this._get<T>(priv, undefined, markCacheDirty)) || Automerge.init<T>()
		this.dags[pubString] = this.dags[pubString] || new DAG()
		const dag = this.dags[pubString]

		// change
		const newDoc = description ? Automerge.change(curDoc, description, fn) : Automerge.change(curDoc, fn)

		// commit

		const changes = Automerge.getChanges(curDoc, newDoc)

		if (!changes.length) {
			return curDoc
		}

		const encrypted = await this.config.crypto.encrypt(encryptKey || sha256(priv), packChanges(changes))
		const v = new DAGVertex(encrypted)
		dag.addReduced(v)

		const edges = dag.parentEdges(v.id)

		const payload = await getPayload<MetadataAddPayload>({
			crypto: this.config.crypto,
			payload: {
				isPublic,
				metadataV2Edges: edges.map((edge) => bytesToB64(edge.binary)),
				metadataV2Key: pubString,
				metadataV2Sig: bytesToB64(await this.config.crypto.sign(priv, await dag.digest(v.id, sha256))),
				metadataV2Vertex: bytesToB64(v.binary),
			},
		})

		await this.config.net.POST<MetadataAddRes>(
			this.config.metadataNode + "/api/v2/metadata/add",
			undefined,
			JSON.stringify(payload),
			(res) => new Response(res).json(),
		)

		this.dags[pubString] = dag
		this.cache[pubString] = {
			lastAccess: Date.now(),
			dirty: false,
			doc: newDoc,
		}

		setTimeout(() => {
			delete this.dags[pubString]
			delete this.cache[pubString]
		}, 60 * 1000)

		return newDoc
	}

	async get<T> (path: string, markCacheDirty = false): Promise<Automerge.Doc<T> | undefined> {
		// console.log("get(", path, ")")

		path = cleanPath(path)

		const priv = await this.config.crypto.derive(undefined, path)
		return await this._get<T>(priv, undefined, markCacheDirty)
	}

	async _get<T> (
		priv: Uint8Array,
		decryptKey?: Uint8Array,
		markCacheDirty = false,
	): Promise<Automerge.Doc<T> | undefined> {
		// console.log("_get(", priv, decryptKey, ")")

		const pub = await this.config.crypto.getPublicKey(priv)
		const pubString = bytesToB64(pub)

		const cached = this.cache[pubString]

		if (markCacheDirty || !cached || cached.dirty == true) {
			console.warn(
				"Cache: cache not used for",
				pubString,
				"because",
				!cached ? "item was not found in cache" : "cache entry was marked dirty",
			)
			const payload = await getPayload<MetadataGetPayload>({
				crypto: this.config.crypto,
				payload: {
					metadataV2Key: pubString,
				},
			})

			const res = await this.config.net.POST<MetadataGetRes>(
				this.config.metadataNode + "/api/v2/metadata/get",
				undefined,
				JSON.stringify(payload),
				(res) => new Response(res).json(),
			)

			if (((res.data as unknown) as string) == "Key not found") {
				return undefined
			}

			const dag = DAG.fromBinary(b64ToBytes(res.data.metadataV2))
			this.dags[pubString] = dag
		}
		else {
			console.info("Cache: using cached value for", pubString)

			cached.lastAccess = Date.now()

			return cached.doc as Automerge.Doc<T>
		}

		const decrypted = await Promise.all(
			this.dags[pubString].nodes.map(({ data }) => this.config.crypto.decrypt(decryptKey || sha256(priv), data)),
		)
		const changes = decrypted.map((data) => unpackChanges(data)).flat()

		const doc = Automerge.applyChanges(Automerge.init<T>(), changes)
		this.cache[pubString] = {
			lastAccess: Date.now(),
			dirty: false,
			doc,
		}

		setTimeout(() => {
			delete this.dags[pubString]
			delete this.cache[pubString]
		}, 60 * 1000)

		return doc
	}

	async getPublic<T> (
		priv: Uint8Array,
		decryptKey: Uint8Array,
		markCacheDirty = false,
	): Promise<Automerge.Doc<T> | undefined> {
		return await this._getPublic(priv, decryptKey)
	}

	async _getPublic<T> (
		priv: Uint8Array,
		decryptKey: Uint8Array,
		markCacheDirty = false,
	): Promise<Automerge.Doc<T> | undefined> {
		// console.log("_getPublic", priv, decryptKey, ")")

		const pub = await this.config.crypto.getPublicKey(priv)
		const pubString = bytesToB64(pub)

		const cached = this.cache[pubString]

		if (markCacheDirty || !cached || cached.dirty == true) {
			console.warn(
				"Cache: cache not used for",
				pubString,
				"because",
				!cached ? "item was not found in cache" : "cache entry was marked dirty",
			)

			const res = await this.config.net.POST<MetadataGetRes>(
				this.config.metadataNode + "/api/v2/metadata/get-public",
				undefined,
				JSON.stringify({
					requestBody: JSON.stringify({
						metadataV2Key: pubString,
						timestamp: Math.floor(Date.now() / 1000),
					}),
				}),
				(res) => new Response(res).json(),
			)

			const dag = DAG.fromBinary(b64ToBytes(res.data.metadataV2))
			this.dags[pubString] = dag
		}
		else {
			console.info("Cache: using cached value for", pubString)

			return cached.doc as Automerge.Doc<T>
		}

		const decrypted = await Promise.all(
			this.dags[pubString].nodes.map(({ data }) => this.config.crypto.decrypt(decryptKey, data)),
		)
		const changes = decrypted.map((data) => unpackChanges(data)).flat()

		const doc = Automerge.applyChanges(Automerge.init<T>(), changes)

		this.cache[pubString] = {
			lastAccess: Date.now(),
			dirty: false,
			doc,
		}

		setTimeout(() => {
			delete this.dags[pubString]
			delete this.cache[pubString]
		}, 60 * 1000)

		return doc
	}

	async delete (path: string): Promise<void> {
		// console.log("delete(", path, ")")

		path = cleanPath(path)

		const priv = await this.config.crypto.derive(undefined, path)

		await this._delete(priv)
		await this._metadataIndexRemove(priv)
	}

	async deletePublic (priv: Uint8Array): Promise<void> {
		// console.log("deletePublic(", priv, ")")

		await this._delete(priv)
		await this._metadataIndexRemove(priv)
	}

	async _delete (priv: Uint8Array): Promise<void> {
		// console.log("_delete(", priv, ")")

		const pub = await this.config.crypto.getPublicKey(priv)
		const pubString = bytesToB64(pub)

		const payload = await getPayload<MetadataDeletePayload>({
			crypto: this.config.crypto,
			payload: {
				metadataV2Key: pubString,
			},
		})

		await this.config.net.POST<MetadataDeleteRes>(
			this.config.metadataNode + "/api/v2/metadata/delete",
			undefined,
			JSON.stringify(payload),
			(res) => new Response(res).json(),
		)

		delete this.dags[pubString]
		delete this.cache[pubString]
	}
}
