import { AccountSystem, FileMetadata } from "@opacity/account-system"
import { extractPromise } from "@opacity/util/src/promise"
import { TransparentDownload } from "./download"
import { TransparentFileSystemObject } from "./filesystem-object"
import { TransparentUpload } from "./upload"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: TransparentUpload) => {
	const [fileMetadata, resolveFileMetadata] = extractPromise<FileMetadata>()

	u._beforeUpload = async (u) => {
		const file = await accountSystem.addUpload(
			await u.getLocation(),
			await u.getEncryptionKey(),
			u._path,
			u._name,
			u._metadata,
			true,
		)

		resolveFileMetadata(file)
	}

	u._afterUpload = async () => {
		const file = await fileMetadata

		await accountSystem.finishUpload(file.location)
	}
}

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: TransparentDownload) => {
	// TODO: download history
}

export const bindFileSystemObjectToAccountSystem = (accountSystem: AccountSystem, o: TransparentFileSystemObject) => {
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
