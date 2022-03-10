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
import { FileMetadata } from "@opacity/account-system/src"

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
}

export class SiaDownload extends EventTarget implements Downloader, IDownloadEvents, ISiaDownloadEvents {
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

	_downloadUrl?: string
	_metadata?: FileMeta

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


	constructor ({ config, handle, name, fileMeta }: SiaDownloadArgs) {
		super()

		this.config = config
		this.config.queueSize = this.config.queueSize || {}
		this.config.queueSize.net = this.config.queueSize.net || 3
		this.config.queueSize.decrypt = this.config.queueSize.decrypt || blocksPerPart

		this._location[1](handle.slice(0, 32))
		this._encryptionKey[1](handle.slice(32))

		this._name = name

		this._fileMeta = fileMeta

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

	async downlaod (): Promise<string | undefined> {
		return this._m.runExclusive(async () => {
			const d = this

			const downloadUrlRes = await d.config.net
				.POST(
					d.config.storageNode + "/api/v2/sia/download",
					undefined,
					JSON.stringify({ fileID: bytesToHex(await d.getLocation()) }),
					async (b) => JSON.parse(new TextDecoder("utf8").decode(await new Response(b).arrayBuffer())).fileDownloadUrl,
				)
				.catch(d._reject)

			if (!downloadUrlRes) {
				return
			}

			const fileData = downloadUrlRes.data

			return fileData
		})
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
