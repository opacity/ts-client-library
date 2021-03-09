import { AccountSystem } from "@opacity/account-system/src/AccountSystem"

import { Download } from "./download"
import { Upload } from "./upload"
import { UploadEvents, UploadMetadataEvent } from "./events"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: Upload) => {
	u.addEventListener(UploadEvents.METADATA, ((e: UploadMetadataEvent) => {
		accountSystem.addUpload(u._location!, u._key!, u._path, u._name, e.detail.metadata)
	}) as EventListener)

	u.addEventListener(UploadEvents.FINISH, () => {
		accountSystem.finishUpload(u._location!)
	})
}

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: Download) => {
	// TODO: download history
}
