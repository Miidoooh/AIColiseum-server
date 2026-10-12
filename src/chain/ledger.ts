import { JsonFile } from './json-file';

/** Every burn signature already redeemed, so one burn can never be spent twice. */
export class BurnLedger {
  private readonly file: JsonFile<Record<string, string>>;

  constructor(path: string) {
    this.file = new JsonFile(path, () => ({}));
  }

  async has(signature: string): Promise<boolean> {
    return signature in (await this.file.read());
  }

  /** Records the signature; returns false when it had already been redeemed. */
  claim(signature: string, purpose: string): Promise<boolean> {
    return this.file.update((doc) => {
      if (signature in doc) return false;
      doc[signature] = purpose;
      return true;
    });
  }
}
