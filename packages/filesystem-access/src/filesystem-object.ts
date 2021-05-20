import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { FileMeta } from "./filemeta"
import { FileSystemObjectDeleteEvent } from "./events"
import { getPayload } from "@opacity/util/src/payload"
import { serializeEncrypted } from "@opacity/util/src/serializeEncrypted"

export interface IFileSystemObject {
	readonly public: boolean
	readonly private: boolean

	readonly handle: Uint8Array | undefined
	readonly location: Uint8Array | undefined

	exists(): Promise<boolean>
	metadata(): Promise<FileMeta | undefined>

	_beforeDelete?: (o: this) => Promise<void>
	_afterDelete?: (o: this) => Promise<void>
	delete(): Promise<void>

	_beforeConvertToPublic?: (o: this) => Promise<void>
	_afterConvertToPublic?: (o: this, res: PrivateToPublicResp) => Promise<void>
	convertToPublic(): Promise<void>
}

export class FileSystemObjectDeletionError extends Error {
	constructor (location: string, err: string) {
		super(`DeletionError: Failed to delete "${location}". Error: "${err}"`)
	}
}

export class FileSystemObjectConvertPublicError extends Error {
	constructor (reason: string) {
		super(`ConvertPublicError: Failed to convert file because ${reason}`)
	}
}

type PrivateToPublicObj = {
	fileHandle: string
}

type PrivateToPublicResp = {
	s3_url: string
	s3_thumbnail_url: string
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

	constructor ({ handle, location, config }: FileSystemObjectArgs) {
		super()

		this._handle = handle
		this._location = location

		this.config = config
	}

	private async _getDownloadURL (fileID: Uint8Array) {
		const res = await this.config.net.POST(
			this.config.storageNode + "/api/v1/download",
			undefined,
			JSON.stringify({
				fileID: bytesToHex(fileID),
			}),
			(b) => new Response(b).text(),
		)

		return res
	}

	async exists () {
		if (!this._handle && !this._location) {
			console.warn("filesystem object already deleted")

			return false
		}

		if (this._handle) {
			const fileID = this._handle!.slice(0, 32)

			const res = await this._getDownloadURL(fileID)

			if (res.status == 200) {
				return true
			}
		}

		if (this._location) {
			const fileID = this._location!.slice(0, 32)

			const res = await this._getDownloadURL(fileID)

			if (res.status == 200) {
				return true
			}
		}

		return false
	}

	async metadata (): Promise<FileMeta | undefined> {
		if (!this._handle && !this._location) {
			console.warn("filesystem object already deleted")

			return
		}

		const fileID = this._location ? this._location.slice(0, 32) : this._handle!.slice(0, 32)

		const downloadURL = await this._getDownloadURL(fileID)

		const res = await this.config.net.GET(
			downloadURL + "/metadata",
			undefined,
			undefined,
			async (rs) => new Uint8Array(await new Response(rs).arrayBuffer()),
		)

		if (!res.ok) {
			return
		}

		if (this._handle) {
			return serializeEncrypted<FileMeta>(this.config.crypto, res.data, this._handle.slice(32, 64))
		}

		if (this._location) {
			return JSON.parse(new TextDecoder().decode(res.data)) as FileMeta
		}
	}

	_beforeDelete?: (o: FileSystemObject) => Promise<void>
	_afterDelete?: (o: FileSystemObject) => Promise<void>

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

	_beforeConvertToPublic?: (o: FileSystemObject) => Promise<void>
	_afterConvertToPublic?: (o: FileSystemObject) => Promise<void>

	async convertToPublic (): Promise<void> {
		if (this._location) {
			throw new FileSystemObjectConvertPublicError("file is already public")
		}

		if (!this._handle) {
			throw new FileSystemObjectConvertPublicError("file has no private source")
		}

		if (this._beforeConvertToPublic) {
			await this._beforeConvertToPublic(this)
		}

		const payload = await getPayload<PrivateToPublicObj>({
			crypto: this.config.crypto,
			payload: {
				fileHandle: bytesToHex(this._handle),
			},
		})

		const res = await this.config.net.POST<PrivateToPublicResp>(
			this.config.storageNode + "/api/v2/public-share/convert",
			undefined,
			JSON.stringify(payload),
			(b) => new Response(b).json(),
		)

		if (this._afterConvertToPublic) {
			await this._afterConvertToPublic(this)
		}

		this._location = this._handle.slice(0, 32)
		this._handle = undefined
	}
}
