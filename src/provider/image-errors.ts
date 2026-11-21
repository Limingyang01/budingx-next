// SP007 MM-08：图片不支持错误判定。实现已移至 core（Session 消费，core 禁
// import provider）；此处 re-export 保持 provider 侧入口与 T2 测试不变。
export { isImageUnsupportedError } from '../core/image-errors.js'
