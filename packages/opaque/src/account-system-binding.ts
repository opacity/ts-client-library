import { AccountSystem, FileMetadata } from "@opacity/account-system"
import { extractPromise } from "@opacity/util/src/promise"
import { OpaqueDownload } from "./download"
import { OpaqueFileSystemObject } from "./filesystem-object"
import { OpaqueUpload } from "./upload"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: OpaqueUpload) => {
	const [fileMetadata, resolveFileMetadata] = extractPromise<FileMetadata>()

	u._beforeUpload = async (u) => {
		const file = await accountSystem.addUpload(
			await u.getLocation(),
			await u.getEncryptionKey(),
			u._path,
			u._name,
			u._metadata,
			false,
		)

		resolveFileMetadata(file)
	}

	u._afterUpload = async () => {
		const file = await fileMetadata

		await accountSystem.finishUpload(file.location)
	}
}

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: OpaqueDownload) => {
	// TODO: download history
}

export const bindFileSystemObjectToAccountSystem = (accountSystem: AccountSystem, o: OpaqueFileSystemObject) => {
	// handle deletion
	o._afterDelete = async (o) => {
		const handle = o._handle

		if (!handle) {
			throw new Error("filesystem object error")
		}

		const locaction = await accountSystem.getFileLocationByHandle(handle)
		await accountSystem.removeFile(locaction)
	}
}
