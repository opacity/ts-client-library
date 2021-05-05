import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { getPayload } from "@opacity/util/src/payload"
import { FileSystemObjectDeleteEvent } from "@opacity/filesystem-access/src/events"

export class DeletionError extends Error {
	constructor (location: string, err: string) {
		super(`DeletionError: Failed to delete "${location}". Error: "${err}"`)
	}
}

export type FileSystemObjectConfig = {
	crypto: CryptoMiddleware
	net: NetworkMiddleware

	storageNode: string
}

export class FileSystemObject extends EventTarget {
	_handle?: Uint8Array

	config: FileSystemObjectConfig

	_beforeDelete?: (o: FileSystemObject) => Promise<void>
	_afterDelete?: (o: FileSystemObject) => Promise<void>

	constructor (handle: Uint8Array, config: FileSystemObjectConfig) {
		super()

		this._handle = handle

		this.config = config
	}

	async exists () {
		if (!this._handle) {
			console.warn("filesystem object already deleted")

			return
		}

		const res = await this.config.net.POST(
			this.config.storageNode + "/api/v1/download",
			undefined,
			JSON.stringify({
				fileID: bytesToHex(this._handle.slice(0, 32)),
			}),
			(b) => new Response(b).text(),
		)

		if (res.status == 200) {
			return true
		}

		return false
	}

	async delete () {
		if (!this._handle) {
			console.warn("filesystem object already deleted")

			return
		}

		if (this._beforeDelete) {
			await this._beforeDelete(this)
		}

		this.dispatchEvent(new FileSystemObjectDeleteEvent({}))

		const location = this._handle.slice(0, 32)

		const payload = await getPayload({
			crypto: this.config.crypto,
			payload: { fileID: bytesToHex(location) },
		})

		const res = await this.config.net.POST(
			this.config.storageNode + "/api/v1/delete",
			undefined,
			JSON.stringify(payload),
			(b) => new Response(b).text(),
		)

		if (res.status != 200) {
			throw new DeletionError(bytesToHex(location), res.data)
		}

		if (this._afterDelete) {
			await this._afterDelete(this)
		}

		// clear sensitive data
		delete this._handle
	}
}
