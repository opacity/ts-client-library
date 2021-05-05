import { AccountSystem, FileMetadata } from "@opacity/account-system"
import { Downloader } from "./downloader"
import { extractPromise } from "@opacity/util/src/promise"
import { IFileSystemObject } from "./filesystem-object"
import { Uploader } from "./uploader"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: Uploader) => {
	const [fileMetadata, resolveFileMetadata] = extractPromise<FileMetadata>()

	u._beforeUpload = async (u) => {
		const file = await accountSystem.addUpload(
			await u.getLocation(),
			await u.getEncryptionKey(),
			u.path,
			u.name,
			u.metadata,
			u.public,
		)

		resolveFileMetadata(file)
	}

	u._afterUpload = async () => {
		const file = await fileMetadata

		await accountSystem.finishUpload(file.location)
	}
}

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: Downloader) => {
	// TODO: download history
}

export const bindFileSystemObjectToAccountSystem = (accountSystem: AccountSystem, o: IFileSystemObject) => {
	// handle deletion
	o._afterDelete = async (o) => {
		const fileHandle = o.handle
		const fileLocation = o.location

		if (!fileHandle && !fileLocation) {
			throw new Error("filesystem object error: cannot find valid source")
		}

		const metaLocaction = fileHandle
			? await accountSystem.getFileMetadataLocationByFileHandle(fileHandle!)
			: await accountSystem.getFileMetadataLocationByFileLocation(fileLocation!)

		await accountSystem.removeFile(metaLocaction)
	}
}
