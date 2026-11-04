import { Caption } from '../models/caption.model';

const TIMING = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;
const TAGS = /<[^>]*>/g;

export function parseCues(text: string): readonly Caption[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const captions: Caption[] = [];
  let index = 0;
  while (index < lines.length) {
    const match = TIMING.exec(lines[index]);
    if (!match) {
      index += 1;
      continue;
    }
    const start = toSeconds(match[1], match[2], match[3], match[4]);
    const end = toSeconds(match[5], match[6], match[7], match[8]);
    const body: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '') {
      body.push(lines[index].replace(TAGS, '').trim());
      index += 1;
    }
    const cueText = body.filter((line) => line.length > 0).join(' ');
    if (cueText.length > 0 && end > start) {
      captions.push({ startSeconds: start, endSeconds: end, text: cueText });
    }
  }
  return captions.sort((a, b) => a.startSeconds - b.startSeconds);
}

function toSeconds(hours: string | undefined, minutes: string, seconds: string, millis: string): number {
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}
