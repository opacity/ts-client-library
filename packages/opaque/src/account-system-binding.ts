import { AccountSystem } from "@opacity/account-system/src/AccountSystem"

import { Download } from "./download"
import { Upload } from "./upload"
import { UploadEvents, UploadMetadataEvent } from "./events"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: Upload) => {
	let waitForAddUploadFinish: Promise<void>

	u.addEventListener(UploadEvents.METADATA, ((e: UploadMetadataEvent) => {
		waitForAddUploadFinish = accountSystem.addUpload(u._location!, u._key!, u._path, u._name, e.detail.metadata)
	}) as EventListener)

	u.addEventListener(UploadEvents.FINISH, async () => {
		const location = u._location!

		await waitForAddUploadFinish

		accountSystem.finishUpload(location)
	})
}

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: Download) => {
	// TODO: download history
}
