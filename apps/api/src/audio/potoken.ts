import { JSDOM } from 'jsdom';
import { getChallenge, BotGuardClient } from 'bgutils-js/botguard';
import { base64ToU8, u8ToBase64 } from 'bgutils-js/utils';
import { fetchMetadata } from './network.js';

type MintCallback = (buffer: Uint8Array) => Promise<Uint8Array | undefined>;

export class PoTokenService {
  private mintCallback?: MintCallback;
  private expiresAt = 0;
  private inFlightInit?: Promise<MintCallback>;

  /**
   * Initializes or refreshes the BotGuard WebPO minter.
   */
  private async getMinter(): Promise<MintCallback> {
    const now = Date.now();
    if (this.mintCallback && this.expiresAt > now + 5 * 60 * 1000) {
      return this.mintCallback;
    }

    if (this.inFlightInit) {
      return this.inFlightInit;
    }

    const task = this.initMinter()
      .then(({ callback, expiresAt }) => {
        this.mintCallback = callback;
        this.expiresAt = expiresAt;
        return callback;
      })
      .finally(() => {
        this.inFlightInit = undefined;
      });

    this.inFlightInit = task;
    return task;
  }

  private async initMinter(): Promise<{
    callback: MintCallback;
    expiresAt: number;
  }> {
    const dom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body></body></html>',
      {
        url: 'https://www.youtube.com/',
        referrer: 'https://www.youtube.com/',
        runScripts: 'dangerously',
      },
    );
    const window = dom.window;

    const requestKey = 'O43z0dpjhgX20SCx4KAo';
    const challenge = await getChallenge({
      requestKey,
      fetchFunction: fetchMetadata,
      useYouTubeAPI: true,
    });

    const interpreterJs =
      challenge.interpreterJavascript
        ?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreterJs) {
      throw new Error('Script interprete BotGuard non disponibile');
    }

    window.eval(interpreterJs);

    const bgClient = await BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObject: window,
    });

    const webPoSignalOutput: Array<
      ((buffer: Uint8Array) => Promise<MintCallback>) | undefined
    > = [];
    const botguardResponse = await bgClient.snapshot({ webPoSignalOutput });

    const itPayload = [requestKey, botguardResponse];
    const itRes = await fetchMetadata(
      'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json+protobuf',
          // Public client identifier documented by bgutils-js; not an operator credential.
          'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
          'x-user-agent': 'grpc-web-javascript/0.1',
        },
        body: JSON.stringify(itPayload),
      },
    );

    if (!itRes.ok) {
      throw new Error(
        `GenerateIT fallito con codice di stato: ${itRes.status}`,
      );
    }

    const itJson = (await itRes.json()) as [string, number, number, string];
    const [integrityToken, estimatedTtlSecs] = itJson;

    const getMinterFn = webPoSignalOutput[0];
    if (!getMinterFn) {
      throw new Error(
        'Funzione WebPoSignalOutput non trovata nel responso BotGuard',
      );
    }

    const mintCallback = await getMinterFn(base64ToU8(integrityToken));
    if (typeof mintCallback !== 'function') {
      throw new Error('Callback di minting PoToken non valida');
    }

    // Default TTL is typically 12 hours (43200s); buffer by 5 minutes
    const ttlSeconds =
      typeof estimatedTtlSecs === 'number' && estimatedTtlSecs > 300
        ? estimatedTtlSecs
        : 43200;
    const expiresAt = Date.now() + (ttlSeconds - 300) * 1000;

    return { callback: mintCallback, expiresAt };
  }

  /**
   * Generates a web-safe content-bound Proof of Origin token for the given video ID.
   */
  async mintPoToken(videoId: string): Promise<string> {
    try {
      const minter = await this.getMinter();
      const rawBytes = await minter(new TextEncoder().encode(videoId));
      if (!rawBytes) {
        throw new Error('Minter ha restituito un buffer vuoto');
      }
      return u8ToBase64(new Uint8Array(rawBytes), true);
    } catch (err) {
      // In case of error (e.g. minter expired unexpectedly), evict and retry once
      this.mintCallback = undefined;
      this.expiresAt = 0;
      const minter = await this.getMinter();
      const rawBytes = await minter(new TextEncoder().encode(videoId));
      if (!rawBytes) {
        throw new Error(
          `Impossibile generare PoToken: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      return u8ToBase64(new Uint8Array(rawBytes), true);
    }
  }
}
