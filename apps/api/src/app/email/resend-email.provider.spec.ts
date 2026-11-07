import {
  EmailDeliveryError,
  RESEND_API_URL,
  ResendEmailProvider,
  type FetchLike,
} from './resend-email.provider.js';

const message = {
  to: 'ana@example.com',
  subject: 'Olá',
  text: 'texto',
  html: '<p>html</p>',
  headers: { 'List-Unsubscribe': '<https://api/x>' },
};

function fakeFetch(status: number, body: unknown, reject?: Error) {
  return jest.fn(async (..._args: Parameters<FetchLike>) => {
    void _args;
    if (reject) throw reject;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

describe('ResendEmailProvider', () => {
  it('POSTs the message to the Resend API with the bearer key', async () => {
    const fetch = fakeFetch(200, { id: 'msg_123' });
    const p = new ResendEmailProvider(
      're_key',
      'Codify <hi@codify.app>',
      fetch,
    );
    expect(await p.send(message)).toEqual({ id: 'msg_123' });
    const [url, init] = fetch.mock.calls[0] as Parameters<FetchLike>;
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({
      from: 'Codify <hi@codify.app>',
      to: ['ana@example.com'],
      subject: 'Olá',
      html: '<p>html</p>',
      text: 'texto',
      headers: { 'List-Unsubscribe': '<https://api/x>' },
    });
    expect(init.signal).toBeDefined();
  });

  it('throws a typed error with the API message on a non-2xx answer', async () => {
    const p = new ResendEmailProvider(
      'k',
      'f',
      fakeFetch(422, { message: 'Invalid `to` field' }),
    );
    await expect(p.send(message)).rejects.toMatchObject({
      name: 'EmailDeliveryError',
      status: 422,
      message: expect.stringContaining('Invalid `to` field'),
    });
  });

  it('wraps network failures and missing ids', async () => {
    const down = new ResendEmailProvider(
      'k',
      'f',
      fakeFetch(0, null, new Error('ECONNRESET')),
    );
    await expect(down.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
    const noId = new ResendEmailProvider('k', 'f', fakeFetch(200, {}));
    await expect(noId.send(message)).rejects.toThrow('no id');
  });
});
