# IPHONE-DATA-TRANSFER-GLOBE-PROTO

## Pulse Pair prototype

A two-device browser demo inspired by visual proximity pairing. It is not Apple Quick Start and does not copy Apple’s protocol.

## Run it

```powershell
npm start
```

Open the printed URL on the first device, select **Create a pairing pulse**, then use **Scan a pulse** from the second device. The QR payload is a temporary session ID; the animated orb is the visual treatment around it. Once paired, the phones can exchange short messages through the local demo server.

## Important prototype limitations

- The scanner loads QR libraries from jsDelivr, so it needs internet access.
- Mobile browsers only expose the camera in a secure context. `http://localhost` works on the computer running the server; for another phone use HTTPS (for example, deploy it or use an HTTPS tunnel) and open that HTTPS URL on both phones.
- Session data is in server memory, expires after two minutes, and is not end-to-end encrypted. A production design needs HTTPS, authenticated devices, signed short-lived tokens, rate limits, and an encrypted transport.
