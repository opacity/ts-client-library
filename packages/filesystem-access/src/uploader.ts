import { FileMeta } from "./filemeta"

export interface Uploader {
	getLocation (): Promise<Uint8Array>
	getEncryptionKey (): Promise<Uint8Array>

	readonly cancelled: boolean
	readonly errored: boolean
	readonly started: boolean
	readonly done: boolean
	readonly paused: boolean

	readonly name: string
	readonly path: string
	readonly metadata: FileMeta

	readonly size: number
	readonly sizeOnFS: number

	readonly output: TransformStream<Uint8Array, Uint8Array> | undefined

	readonly startTime: number | undefined
	readonly endTime: number | undefined
	readonly pauseDuration: number

	_beforeUpload?: (u: this) => Promise<void>
	_afterUpload?: (u: this) => Promise<void>

	pause (): Promise<void>
	unpause (): Promise<void>

	start (): Promise<TransformStream<Uint8Array, Uint8Array> | undefined>
	finish (): Promise<void>

	cancel (): Promise<void>
}
