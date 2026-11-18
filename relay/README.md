# Memoria relay

Lets a paired phone sync with your PC from anywhere, not only on the same Wi-Fi.
The phone leaves its encrypted request in your PC's mailbox on the relay; the PC
collects it, answers, and the answer goes back. The relay only ever holds
ciphertext. It cannot read your data or pretend to be a paired device, and
pairing itself still happens on your Wi-Fi.

It runs on your own Cloudflare account, on the free plan.

## Deploy

```sh
cd relay
npx wrangler login     # once: opens Cloudflare in the browser
npx wrangler deploy    # prints https://memoria-relay.<you>.workers.dev
```

Then on the PC: **Settings → Device sync → Sync away from home**, paste the
address and save. Phones that are already paired pick it up on their next sync
at home; after that they reach the PC through the relay whenever it is out of
reach. The PC has to be on with Memoria running, as for Wi-Fi sync.

## Limits

- One mailbox per PC, named from the PC's key fingerprint. The first PC to
  collect from it claims it with a token kept in its `devices.json`.
- A request waits up to 25 seconds for the PC to answer.
- Free-plan Durable Objects allow 100,000 requests a day. A PC waiting for
  requests uses about 3,500 of them a day.
