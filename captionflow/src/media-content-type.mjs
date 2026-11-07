/** MIME types for caption transcription CLI inputs. Match media bytes' file extension;
 * do not label a WebM upload as MP4. Browser uploads use their supplied MIME type.
 */
import { extname } from 'node:path';

const MIME_BY_EXTENSION = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.mpeg', 'video/mpeg'],
  ['.mpg', 'video/mpeg'],
  ['.avi', 'video/avi'],
]);

export function mediaContentTypeForFile(path) {
  const type = MIME_BY_EXTENSION.get(extname(path).toLowerCase());
  if (!type) throw new Error('Unsupported video extension; use MP4, WebM, MOV, MPEG or AVI');
  return type;
}