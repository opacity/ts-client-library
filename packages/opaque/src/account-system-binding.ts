import { AccountSystem, FileMetadata } from "@opacity/account-system"
import { extractPromise } from "@opacity/util/src/promise"

import { FileSystemObject } from "./filesystem-object"
import { Download } from "./download"
import { Upload } from "./upload"
import { arrayMerge } from "@opacity/util/src/arrayMerge"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: Upload) => {
	const [fileMetadata, resolveFileMetadata] = extractPromise<FileMetadata>()

	u._beforeUpload = async (u) => {
		const file = await accountSystem.addUpload(
			arrayMerge(await u.getLocation(), await u.getEncryptionKey()),
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

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: Download) => {
	// TODO: download history
}

export const bindFileSystemObjectToAccountSystem = (accountSystem: AccountSystem, o: FileSystemObject) => {
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
