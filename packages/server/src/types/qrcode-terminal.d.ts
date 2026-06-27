declare module 'qrcode-terminal' {
  interface GenerateOptions {
    small?: boolean;
  }

  function generate(text: string, options?: GenerateOptions, cb?: (qr: string) => void): void;
  function generate(text: string, cb?: (qr: string) => void): void;

  export default { generate };
}
