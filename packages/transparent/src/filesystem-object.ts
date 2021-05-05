import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { FileSystemObjectDeleteEvent } from "@opacity/filesystem-access/src/events"
import { getPayload } from "@opacity/util/src/payload"

export class TransparentDeletionError extends Error {
	constructor (location: string, err: string) {
		super(`DeletionError: Failed to delete "${location}". Error: "${err}"`)
	}
}

export type TransparentFileSystemObjectConfig = {
	crypto: CryptoMiddleware
	net: NetworkMiddleware

	storageNode: string
}

export class TransparentFileSystemObject extends EventTarget {
	_handle?: Uint8Array

	config: TransparentFileSystemObjectConfig

	_beforeDelete?: (o: TransparentFileSystemObject) => Promise<void>
	_afterDelete?: (o: TransparentFileSystemObject) => Promise<void>

	constructor (handle: Uint8Array, config: TransparentFileSystemObjectConfig) {
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
			throw new TransparentDeletionError(bytesToHex(location), res.data)
		}

		if (this._afterDelete) {
			await this._afterDelete(this)
		}

		// clear sensitive data
		delete this._handle
	}
}
