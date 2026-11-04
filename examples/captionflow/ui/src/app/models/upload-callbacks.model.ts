export interface UploadCallbacks {
  readonly onUploadProgress: (fraction: number) => void;
  readonly onWriting: () => void;
}
