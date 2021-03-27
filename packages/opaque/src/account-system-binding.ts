import { AccountSystem, FileMetadata } from "@opacity/account-system"
import { extractPromise } from "@opacity/util/src/promise"

import { FileSystemObject } from "./filesystem-object"
import { Download } from "./download"
import { Upload } from "./upload"
import { FileSystemObjectEvents, UploadEvents, UploadMetadataEvent } from "./events"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: Upload) => {
	const [fileMetadata, resolveFileMetadata] = extractPromise<FileMetadata>()

	u._beforeUpload = async (u) => {
		const file = await accountSystem.addUpload(
			new Uint8Array(Array.from(u._location!).concat(Array.from(u._key!))),
			u._path,
			u._name,
			u._metadata,
			false,
		)

		resolveFileMetadata(file)
	}

	u._afterUpload = async () => {
		await accountSystem.finishUpload((await fileMetadata).location)
	}
}

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: Download) => {
	// TODO: download history
}

export const bindDeleteToAccountSystem = (accountSystem: AccountSystem, o: FileSystemObject) => {
	o._afterDelete = async (o) => {
		const handle = o._handle

		if (!handle) {
			throw new Error("filesystem object error")
		}

		const locaction = await accountSystem.getFileLocationByHandle(handle)
		await accountSystem.removeFile(locaction)
	}
}
