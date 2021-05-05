import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { FileSystemObjectDeleteEvent } from "./events"
import { getPayload } from "@opacity/util/src/payload"

export interface IFileSystemObject {
	readonly public: boolean
	readonly private: boolean

	readonly handle: Uint8Array | undefined
	readonly location: Uint8Array | undefined

	exists(): Promise<boolean>

	_beforeDelete?: (o: this) => Promise<void>
	_afterDelete?: (o: this) => Promise<void>
	delete(): Promise<void>
}

export class FileSystemObjectDeletionError extends Error {
	constructor (location: string, err: string) {
		super(`DeletionError: Failed to delete "${location}". Error: "${err}"`)
	}
}

export type FileSystemObjectConfig = {
	crypto: CryptoMiddleware
	net: NetworkMiddleware

	storageNode: string
}

export type FileSystemObjectArgs = {
	handle: Uint8Array | undefined
	location: Uint8Array | undefined

	config: FileSystemObjectConfig
}

export class FileSystemObject extends EventTarget implements IFileSystemObject {
	_handle?: Uint8Array
	_location?: Uint8Array

	get handle () {
		return this._handle
	}
	get location () {
		return this._location
	}

	get public () {
		return !!this._location
	}
	get private () {
		return !!this._handle
	}

	config: FileSystemObjectConfig

	_beforeDelete?: (o: FileSystemObject) => Promise<void>
	_afterDelete?: (o: FileSystemObject) => Promise<void>

	constructor ({ handle, location, config }: FileSystemObjectArgs) {
		super()

		this._handle = handle
		this._location = location

		this.config = config
	}

	async exists () {
		if (!this._handle && !this._location) {
			console.warn("filesystem object already deleted")

			return false
		}

		if (this._handle) {
			const fileID = this._handle!.slice(0, 32)

			const res = await this.config.net.POST(
				this.config.storageNode + "/api/v1/download",
				undefined,
				JSON.stringify({
					fileID: bytesToHex(fileID),
				}),
				(b) => new Response(b).text(),
			)

			if (res.status == 200) {
				return true
			}
		}

		if (this._location) {
			const fileID = this._location!.slice(0, 32)

			const res = await this.config.net.POST(
				this.config.storageNode + "/api/v1/download",
				undefined,
				JSON.stringify({
					fileID: bytesToHex(fileID),
				}),
				(b) => new Response(b).text(),
			)

			if (res.status == 200) {
				return true
			}
		}

		return false
	}

	async delete () {
		if (!this._handle && !this._location) {
			console.warn("filesystem object already deleted")

			return
		}

		if (this._beforeDelete) {
			await this._beforeDelete(this)
		}

		if (this._handle) {
			this.dispatchEvent(new FileSystemObjectDeleteEvent({}))

			const fileID = this._handle.slice(0, 32)

			const payload = await getPayload({
				crypto: this.config.crypto,
				payload: { fileID: bytesToHex(fileID) },
			})

			const res = await this.config.net.POST(
				this.config.storageNode + "/api/v1/delete",
				undefined,
				JSON.stringify(payload),
				(b) => new Response(b).text(),
			)

			if (res.status != 200) {
				throw new FileSystemObjectDeletionError(bytesToHex(fileID), res.data)
			}

			if (this._afterDelete) {
				await this._afterDelete(this)
			}

			// clear sensitive data
			delete this._handle
		}

		if (this._location) {
			this.dispatchEvent(new FileSystemObjectDeleteEvent({}))

			const fileID = this._location.slice(0, 32)

			const payload = await getPayload({
				crypto: this.config.crypto,
				payload: { fileID: bytesToHex(fileID) },
			})

			const res = await this.config.net.POST(
				this.config.storageNode + "/api/v1/delete",
				undefined,
				JSON.stringify(payload),
				(b) => new Response(b).text(),
			)

			if (res.status != 200) {
				throw new FileSystemObjectDeletionError(bytesToHex(fileID), res.data)
			}

			if (this._afterDelete) {
				await this._afterDelete(this)
			}

			// clear sensitive data
			delete this._location
		}
	}
}
