import { Mutex } from "async-mutex"

import { blockSizeOnFS, numberOfBlocks, numberOfBlocksOnFS, sizeOnFS } from "@opacity/util/src/blocks"
import { blocksPerPart, numberOfPartsOnFS, partSizeOnFS } from "@opacity/util/src/parts"
import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { Downloader } from "@opacity/filesystem-access/src/downloader"
import {
	DownloadFinishedEvent,
	DownloadMetadataEvent,
	DownloadProgressEvent,
	DownloadStartedEvent,
	IDownloadEvents,
} from "@opacity/filesystem-access/src/events"
import { extractPromise } from "@opacity/util/src/promise"
import { FileMeta } from "@opacity/filesystem-access/src/filemeta"
import {
	ISiaDownloadEvents,
	SiaDownloadBlockFinishedEvent,
	SiaDownloadBlockStartedEvent,
	SiaDownloadPartFinishedEvent,
	SiaDownloadPartStartedEvent,
} from "./events"
import { OQ } from "@opacity/util/src/oqueue"
import {
	polyfillReadableStreamIfNeeded,
	ReadableStream,
	TransformStream,
	WritableStream,
} from "@opacity/util/src/streams"
import { serializeEncrypted } from "@opacity/util/src/serializeEncrypted"
import { Uint8ArrayChunkStream } from "@opacity/util/src/streams"
import { AccountSystem, FileMetadata } from "@opacity/account-system/src"

export type SiaDownloadConfig = {
	storageNode: string

	crypto: CryptoMiddleware
	net: NetworkMiddleware

	queueSize?: {
		net?: number
		decrypt?: number
	}
}

export type SiaDownloadArgs = {
	config: SiaDownloadConfig
	handle: Uint8Array
	name: string
	fileMeta: FileMetadata
	accountSystem: AccountSystem
}

export class SiaDownload extends EventTarget implements Downloader,  IDownloadEvents, ISiaDownloadEvents {
	readonly public = false

	config: SiaDownloadConfig

	_m = new Mutex()

	_location = extractPromise<Uint8Array>()
	_encryptionKey = extractPromise<Uint8Array>()

	async getLocation (): Promise<Uint8Array> {
		return this._location[0]
	}

	async getEncryptionKey (): Promise<Uint8Array> {
		return this._encryptionKey[0]
	}

	_cancelled = false
	_errored = false
	_started = false
	_done = false

	get cancelled () {
		return this._cancelled
	}
	get errored () {
		return this._errored
	}
	get started () {
		return this._started
	}
	get done () {
		return this._done
	}

	_finished: Promise<void>
	_resolve: (value?: void) => void
	_reject: (reason?: any) => void

	_name: string

	_fileMeta: FileMetadata

	get name () {
		return this._name
	}

	_size?: number
	_sizeOnFS?: number
	_numberOfBlocks?: number
	_numberOfParts?: number

	get size () {
		return this._size
	}
	get sizeOnFS () {
		return this._sizeOnFS
	}

	_metadata?: FileMeta
	_accountSystem? : AccountSystem | any


	_netQueue?: OQ<void>
	_decryptQueue?: OQ<Uint8Array>

	_output?: ReadableStream<Uint8Array>

	get output () {
		return this._output
	}

	_timestamps: { start?: number; end?: number; pauseDuration: number } = {
		start: undefined,
		end: undefined,
		pauseDuration: 0,
	}

	get startTime () {
		return this._timestamps.start
	}
	get endTime () {
		return this._timestamps.end
	}
	get pauseDuration () {
		return this._timestamps.pauseDuration
	}

	_beforeDownload?: (d: Downloader | any) => Promise<void>
	_afterDownload?: (d: Downloader | any) => Promise<void>


	constructor ({ config, handle, name, fileMeta, accountSystem }: SiaDownloadArgs) {
		super()

		this.config = config
		this.config.queueSize = this.config.queueSize || {}
		this.config.queueSize.net = this.config.queueSize.net || 3
		this.config.queueSize.decrypt = this.config.queueSize.decrypt || blocksPerPart

		this._location[1](handle.slice(0, 32))
		this._encryptionKey[1](handle.slice(32))

		this._name = name

		this._fileMeta = fileMeta
		this._accountSystem = accountSystem

		const d = this

		const [finished, resolveFinished, rejectFinished] = extractPromise()
		this._finished = finished
		this._resolve = (val) => {
			d._done = true
			resolveFinished(val)

			this._timestamps.end = Date.now()
			this.dispatchEvent(
				new DownloadFinishedEvent({
					start: this._timestamps.start!,
					end: this._timestamps.end,
					duration: this._timestamps.end - this._timestamps.start! - this._timestamps.pauseDuration,
					realDuration: this._timestamps.end - this._timestamps.start!,
				}),
			)
		}
		this._reject = (err) => {
			d._errored = true

			rejectFinished(err)
		}
	}

	async start (): Promise<ReadableStream<Uint8Array> | undefined> {
		if (this._cancelled || this._errored) {
			return
		}

		if (this._started) {
			return this._output
		}

		this._started = true
		this._timestamps.start = Date.now()

		const ping = await this.config.net
			.GET(this.config.storageNode + "", undefined, undefined, async (d) =>
				new TextDecoder("utf8").decode(await new Response(d).arrayBuffer()),
			)
			.catch(this._reject)

		// server didn't respond
		if (!ping) {
			return
		}

		const d = this

		if (this._beforeDownload) {
			await this._beforeDownload(d)
		}

		const fileHandle = this._fileMeta.private.handle

		const metadata = await this._accountSystem.getFileMetadataLocationByFileHandle(fileHandle)
		if (!metadata) {
			return
		}

		d._size = metadata.size
		d._sizeOnFS = sizeOnFS(metadata.size)
		d._numberOfBlocks = 1
		d._numberOfParts = numberOfPartsOnFS(d._sizeOnFS)

		d.dispatchEvent(
			new DownloadStartedEvent({
				time: this._timestamps.start,
			}),
		)

		const netQueue = new OQ<void>(this.config.queueSize!.net)
		const decryptQueue = new OQ<Uint8Array | undefined>(this.config.queueSize!.decrypt)

		d._netQueue = netQueue
		d._decryptQueue = decryptQueue

		let partIndex = 0

		d._output = new ReadableStream<Uint8Array>({
			async pull (controller) {
				if (d._cancelled || d._errored) {
					return
				}

				if (partIndex >= d._numberOfParts!) {
					return
				}

				netQueue.add(
					partIndex,
					async (partIndex) => {
						if (d._cancelled || d._errored) {
							return
						}


						d.dispatchEvent(new SiaDownloadPartStartedEvent({ index: partIndex }))

						const res = await d.config.net
						.POST(
							d.config.storageNode + "/api/v2/sia/download",
							undefined,
							JSON.stringify({ fileID: bytesToHex(await d.getLocation()) }),
							async (b) => JSON.parse(new TextDecoder("utf8").decode(await new Response(b).arrayBuffer())).fileDownloadUrl,
						)
						.catch(d._reject)
		
		

						if (!res || !res.data) {
							return
						}

						const fileData = res.data

						let l = 0
						fileData
							.pipeThrough(
								new TransformStream<Uint8Array, Uint8Array>({
									// log progress
									transform (chunk, controller) {
										d.dispatchEvent(new SiaDownloadBlockStartedEvent({ index: 1 }))
										controller.enqueue(chunk)
									},
								}) as ReadableWritablePair<Uint8Array, Uint8Array>,
							)
							.pipeThrough(new Uint8ArrayChunkStream(d._sizeOnFS))
							.pipeTo(
								new WritableStream<Uint8Array>({
									async write (part) {
											decryptQueue.add(
												1,
												async (blockIndex) => {
													if (d._cancelled || d._errored) {
														return
													}

													const decrypted = await d.config.crypto
														.decrypt(await d.getEncryptionKey(), part)
														.catch(d._reject)

													if (!decrypted) {
														return
													}

													return decrypted
												},
												async (decrypted, blockIndex) => {
													if (!decrypted) {
														return
													}

													controller.enqueue(decrypted)

													d.dispatchEvent(new SiaDownloadBlockFinishedEvent({ index: blockIndex }))
													d.dispatchEvent(new DownloadProgressEvent({ progress: blockIndex / d._numberOfBlocks! }))
												},
											)
									},
								}) as WritableStream<Uint8Array>,
							)

						await decryptQueue.waitForCommit(1)

						d.dispatchEvent(new SiaDownloadPartFinishedEvent({ index: partIndex }))
					},
					() => {},
				)
			},
			async start (controller) {
				netQueue.add(
					1,
					() => {},
					async () => {
						netQueue.close()
					},
				)

				decryptQueue.add(
					1,
					() => {},
					async () => {
						decryptQueue.close()
					},
				)

				// the start function is blocking for pulls so this must not be awaited
				Promise.all([netQueue.waitForClose(), decryptQueue.waitForClose()]).then(async () => {
					if (d._afterDownload) {
						await d._afterDownload(d).catch(d._reject)
					}

					d._resolve()
					controller.close()
				})
			},
			cancel () {
				d._cancelled = true
			},
		}) as ReadableStream<Uint8Array>

		return d._output
	}


	async finish () {
		return this._finished
	}

	async cancel () {
		this._cancelled = true

		if (this._output) {
			this._output.cancel()
		}

		this._reject()
	}
}
