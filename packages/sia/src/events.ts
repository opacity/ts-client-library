import { EventListenerOrEventListenerObject } from "@opacity/util/src/events"

export enum SiaDownloadEvents {
	BLOCK_START = "block-loaded",
	BLOCK_FINISH = "block-finished",
	PART_START = "part-loaded",
	PART_FINISH = "part-finished",
}

type SiaDownloadBlockStartedEventData = { index: number }
export class SiaDownloadBlockStartedEvent extends CustomEvent<SiaDownloadBlockStartedEventData> {
	constructor (data: SiaDownloadBlockStartedEventData) {
		super(SiaDownloadEvents.BLOCK_START, { detail: data })
	}
}
type SiaDownloadBlockFinishedEventData = { index: number }
export class SiaDownloadBlockFinishedEvent extends CustomEvent<SiaDownloadBlockFinishedEventData> {
	constructor (data: SiaDownloadBlockFinishedEventData) {
		super(SiaDownloadEvents.BLOCK_FINISH, { detail: data })
	}
}

type SiaDownloadPartStartedEventData = { index: number }
export class SiaDownloadPartStartedEvent extends CustomEvent<SiaDownloadPartStartedEventData> {
	constructor (data: SiaDownloadPartStartedEventData) {
		super(SiaDownloadEvents.PART_START, { detail: data })
	}
}
type SiaDownloadPartFinishedEventData = { index: number }
export class SiaDownloadPartFinishedEvent extends CustomEvent<SiaDownloadPartFinishedEventData> {
	constructor (data: SiaDownloadPartFinishedEventData) {
		super(SiaDownloadEvents.PART_FINISH, { detail: data })
	}
}

export interface ISiaDownloadEvents {
	addEventListener(
		type: SiaDownloadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: SiaDownloadEvents.BLOCK_START,
		listener: EventListenerOrEventListenerObject<SiaDownloadBlockStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: SiaDownloadEvents.BLOCK_FINISH,
		listener: EventListenerOrEventListenerObject<SiaDownloadBlockFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: SiaDownloadEvents.PART_START,
		listener: EventListenerOrEventListenerObject<SiaDownloadPartStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: SiaDownloadEvents.PART_FINISH,
		listener: EventListenerOrEventListenerObject<SiaDownloadPartFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}

export enum SiaUploadEvents {
	BLOCK_START = "block-loaded",
	BLOCK_FINISH = "block-finished",
	PART_START = "part-loaded",
	PART_FINISH = "part-finished",
}

type SiaUploadBlockStartedEventData = { index: number }
export class SiaUploadBlockStartedEvent extends CustomEvent<SiaUploadBlockStartedEventData> {
	constructor (data: SiaUploadBlockStartedEventData) {
		super(SiaUploadEvents.BLOCK_START, { detail: data })
	}
}
type SiaUploadBlockFinishedEventData = { index: number }
export class SiaUploadBlockFinishedEvent extends CustomEvent<SiaUploadBlockFinishedEventData> {
	constructor (data: SiaUploadBlockFinishedEventData) {
		super(SiaUploadEvents.BLOCK_FINISH, { detail: data })
	}
}

type SiaUploadPartStartedEventData = { index: number }
export class SiaUploadPartStartedEvent extends CustomEvent<SiaUploadPartStartedEventData> {
	constructor (data: SiaUploadPartStartedEventData) {
		super(SiaUploadEvents.PART_START, { detail: data })
	}
}
type SiaUploadPartFinishedEventData = { index: number }
export class SiaUploadPartFinishedEvent extends CustomEvent<SiaUploadPartFinishedEventData> {
	constructor (data: SiaUploadPartFinishedEventData) {
		super(SiaUploadEvents.PART_FINISH, { detail: data })
	}
}

export interface ISiaUploadEvents {
	addEventListener(
		type: SiaUploadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: SiaUploadEvents.BLOCK_START,
		listener: EventListenerOrEventListenerObject<SiaUploadBlockStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: SiaUploadEvents.BLOCK_FINISH,
		listener: EventListenerOrEventListenerObject<SiaUploadBlockFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: SiaUploadEvents.PART_START,
		listener: EventListenerOrEventListenerObject<SiaUploadPartStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: SiaUploadEvents.PART_FINISH,
		listener: EventListenerOrEventListenerObject<SiaUploadPartFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}
