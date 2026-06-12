export interface FileNode {
  name: string
  path: string  // absolute
  isDirectory: boolean
  children?: FileNode[]
}
