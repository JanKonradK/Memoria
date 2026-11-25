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
  collect from it claims it with two secrets kept in its `devices.json` (a
  bearer token and an `X-Memoria-Owner` value). The relay stores only a hash
  of the pair, and every later collect or reply must present both. A mailbox
  claimed by an older Memoria with the token alone moves to the pair on the
  first collect from an updated PC; older PCs are refused once the relay is
  redeployed, so update Memoria on the PC first.
- A request waits up to 25 seconds for the PC to answer, and at most 4
  requests wait at once.
- A request or reply carries at most 8 MiB. Packets are sealed as hex, so that
  is about 4 MB of app data; a larger sync has to happen on Wi-Fi.
- Free-plan Durable Objects allow 100,000 requests a day. A PC with a paired
  phone waits for requests continuously, pausing up to 10 seconds between
  waits while nothing arrives, so it uses at most about 3,500 a day. A PC with
  no paired phone does not poll.
