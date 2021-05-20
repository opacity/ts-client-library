import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { FileMeta } from "./filemeta"
import { FileSystemObjectDeleteEvent } from "./events"
import { getPayload } from "@opacity/util/src/payload"
import { serializeEncrypted } from "@opacity/util/src/serializeEncrypted"

export interface IFileSystemShare {
	readonly shortlink?: string

	_beforePublicShare?: (o: this, fileLocation: Uint8Array, title: string, description: string) => Promise<void>
	_afterPublicShare?: (o: this, fileLocation: Uint8Array, title: string, description: string, shortLink: string) => Promise<void>
	publicShare(title: string, description: string): Promise<string>

	_beforePublicShareRevoke?: (o: this, shortLink: string) => Promise<void>
	_afterPublicShareRevoke?: (o: this, shortLink: string) => Promise<void>
	publicShareRevoke(): Promise<void>
}

export class FileSystemShareCreateShortlinkError extends Error {
	constructor (err: string) {
		super(`CreateShortlinkError: Failed to share file. Recieved: ${err}`)
	}
}

export class FileSystemShareRevokeShortlinkError extends Error {
	constructor (err: string) {
		super(`RevokeShortlinkError: Failed to revoke shared file. Recieved: ${err}`)
	}
}

export class FileSystemShareMissingDataError extends Error {
	constructor (type: string) {
		super(`MissingDataError: Missing ${type} from share properties`)
	}
}

type CreateShortlinkObj = {
	file_id: string
	title: string
	description: string
}

type CreateShortlinkResp = {
	short_id: string
}

type ShortlinkFileResp = {
	s3_url: string
	s3_thumbnail_url: string
}

type PublicShareObj = {
	shortlink: string
}

type PublicShareRevokeRes = {
	status: "Public share revoked"
}

export type FileSystemShareConfig = {
	crypto: CryptoMiddleware
	net: NetworkMiddleware

	storageNode: string
}

export type FileSystemShareArgs = {
	shortLink?: string
	fileLocation?: Uint8Array

	config: FileSystemShareConfig
}

export class FileSystemShare extends EventTarget implements IFileSystemShare {
	_shortlink?: string

	get shortlink () {
		return this._shortlink
	}

	_fileLocation?: Uint8Array

	get fileLocation () {
		return this._fileLocation
	}

	config: FileSystemShareConfig

	constructor ({ shortLink, fileLocation, config }: FileSystemShareArgs) {
		super()

		this._shortlink = shortLink
		this._fileLocation = fileLocation

		this.config = config
	}

	_beforePublicShare?: (o: this, fileLocation: Uint8Array, title: string, description: string) => Promise<void>
	_afterPublicShare?: (o: this, fileLocation: Uint8Array, title: string, description: string, shortLink: string) => Promise<void>

	async publicShare (title: string, description: string): Promise<string> {
		if (this._shortlink) {
			return this._shortlink
		}

		if (!this._fileLocation) {
			throw new FileSystemShareMissingDataError("file location")
		}

		if (this._beforePublicShare) {
			await this._beforePublicShare(this, this._fileLocation, title, description)
		}

		const payload = await getPayload<CreateShortlinkObj>({
			crypto: this.config.crypto,
			payload: {
				file_id: bytesToHex(this._fileLocation),
				description,
				title,
			},
		})

		const res = await this.config.net.POST<CreateShortlinkResp>(
			this.config.storageNode + "/api/v2/public-share/convert",
			undefined,
			JSON.stringify(payload),
			(b) => new Response(b).json(),
		)

		if (!res.ok) {
			throw new FileSystemShareCreateShortlinkError(res.data.toString())
		}

		if (this._afterPublicShare) {
			await this._afterPublicShare(this, this._fileLocation, title, description, res.data.short_id)
		}

		this._shortlink = res.data.short_id

		return res.data.short_id
	}

	_beforePublicShareRevoke?: (o: FileSystemShare, shortLink: string) => Promise<void>
	_afterPublicShareRevoke?: (o: FileSystemShare, shortLink: string) => Promise<void>

	async publicShareRevoke (): Promise<void> {
		if (!this._shortlink) {
			throw new FileSystemShareRevokeShortlinkError("shortlink")
		}

		if (this._beforePublicShareRevoke) {
			await this._beforePublicShareRevoke(this, this._shortlink)
		}

		const payload = await getPayload<PublicShareObj>({
			crypto: this.config.crypto,
			payload: {
				shortlink: this._shortlink,
			},
		})

		const res = await this.config.net.POST<CreateShortlinkResp>(
			this.config.storageNode + "/api/v2/public-share/convert",
			undefined,
			JSON.stringify(payload),
			(b) => new Response(b).json(),
		)

		if (!res.ok) {
			throw new FileSystemShareCreateShortlinkError(res.data.toString())
		}

		if (this._afterPublicShareRevoke) {
			await this._afterPublicShareRevoke(this, this._shortlink)
		}

		this._shortlink = res.data.short_id

		return
	}
}
