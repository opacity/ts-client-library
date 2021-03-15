import { AccountSystem } from "@opacity/account-system"
import { extractPromise } from "@opacity/util/src/promise"

import { Download } from "./download"
import { Upload } from "./upload"
import { UploadEvents, UploadMetadataEvent } from "./events"

export const bindUploadToAccountSystem = (accountSystem: AccountSystem, u: Upload) => {
	const [cleanup, resolveCleanup] = extractPromise()
	const resolveUpload = u._resolve
	u._resolve = resolveCleanup

	const [uploadMetadataLocation, resolveUploadMetadataLocation] = extractPromise<Uint8Array>()
	const [waitForFinishUploadFinish, resolveFinishUploadFinish] = extractPromise()

	u.addEventListener(UploadEvents.METADATA, (async (e: UploadMetadataEvent) => {
		const file = await accountSystem.addUpload(
			new Uint8Array(Array.from(u._location!).concat(Array.from(u._key!))),
			u._path,
			u._name,
			e.detail.metadata
		)
		resolveUploadMetadataLocation(new Uint8Array(Object.values<number>(file.location)))
	}) as unknown as EventListener)

	u.addEventListener(UploadEvents.FINISH, async () => {
		await accountSystem.finishUpload(await uploadMetadataLocation)
		resolveFinishUploadFinish()
	})

	cleanup.then(async () => {
		await waitForFinishUploadFinish

		resolveUpload()
	})
}

export const bindDownloadToAccountSystem = (accountSystem: AccountSystem, d: Download) => {
	// TODO: download history
}
