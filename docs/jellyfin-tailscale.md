# Connecting Jellyfin over Tailscale

Queuest can check your Jellyfin library and mark titles in your queue as **On my media server**. This guide covers setting that up with a Jellyfin server that's reachable only over [Tailscale](https://tailscale.com/), without opening it to the internet or setting up SSL in Jellyfin itself.

You can always mark titles by hand with the checkbox in a title's detail panel. This guide is only for the automatic check.

## How the check works

- Your browser talks to Jellyfin directly. Queuest's servers never see the request, your server address, or your token.
- The address and token are saved on that one device only. They aren't synced to your other devices or included in backups. **Settings → Danger Zone → Reset everything** clears them.
- Queuest asks Jellyfin for every movie and series it has, matches them to your queue by TMDB ID (with IMDb ID as a fallback), and checks the box on any match. It only ever adds marks. It never unchecks a title, so a title you marked by hand for a different server stays marked.
- It runs when you open the app, at most every 6 hours, and from **Settings → Media Server → Check library now**. If your device isn't on Tailscale at the time, the automatic check fails quietly and tries again next time.
- It covers your queue, your personal lists (a title in a list is part of your queue), and, if you use sync, every shared list you belong to. On a shared list it sets only your own mark. Other members don't see it as theirs, and their marks are never touched.
- Movies that Jellyfin groups into a collection (a BoxSet) are checked individually, so a movie inside a collection still matches.

## Why it has to be https on a `.ts.net` address

Queuest is served over https, and browsers block an https page from calling a plain-http address such as `http://100.x.y.z:8096` or `http://jellyfin.local:8096`. That's called mixed content, and there's no setting in Queuest that can get around it.

Queuest's security policy also only allows the browser to connect to `https://*.ts.net` addresses (on any port) besides its own services. So the Settings form only accepts addresses that start with `https://` and end in `.ts.net`.

Tailscale's `serve` command gives you exactly that: a real certificate for an address only your tailnet can reach. Tailscale handles the certificate, and Jellyfin keeps running on plain http.

## Setup

### 1. Turn on HTTPS certificates in Tailscale (one time)

In the [Tailscale admin console](https://login.tailscale.com/admin/dns), under **DNS**:

- enable **MagicDNS**
- enable **HTTPS Certificates**

### 2. Run `tailscale serve` on the Jellyfin machine

On the machine that runs Jellyfin, point Tailscale at Jellyfin's port (8096 by default):

```bash
tailscale serve --bg 8096
```

On Tailscale versions older than about 1.52, the syntax is:

```bash
tailscale serve https / http://127.0.0.1:8096
```

If Jellyfin runs in Docker or on a NAS (Synology, Unraid and similar), Tailscale has to run on that same host, or as a container next to Jellyfin. Run the command there.

Use `serve`, **not** `funnel`. Funnel publishes the server to the whole internet.

### 3. Check the address

```bash
tailscale serve status
```

You should see something like:

```
https://your-server.your-tailnet.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:8096
```

Open that `https://` address in a browser on a device that's on Tailscale. Jellyfin should load with a valid padlock. The first load can take a few seconds while Tailscale gets the certificate.

> **Don't add `:8096` to the address.** `tailscale serve` provides https on the default port (443). Port 8096 is still Jellyfin's plain-http port, so `https://your-server.your-tailnet.ts.net:8096` fails. Firefox shows "SSL received a record that exceeded the maximum permissible length", and Chrome shows `ERR_SSL_PROTOCOL_ERROR`.

Your existing Jellyfin apps on your local network keep working as before, since Jellyfin itself doesn't change.

### 4. Get a token

Either of these works.

**An API key (simplest).** In Jellyfin, go to **Dashboard → API Keys → +** and name it "Queuest". API keys have full admin access to your server, so keep it to devices you trust.

**A non-admin user's token (safer).** Create a Jellyfin user, for example `queuest`, that can see your movie and TV libraries but isn't an administrator. Then sign in as that user to get an access token:

```bash
curl -s -X POST "https://your-server.your-tailnet.ts.net/Users/AuthenticateByName" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: MediaBrowser Client="Queuest", Device="Queuest", DeviceId="queuest-setup", Version="1.0"' \
  -d '{"Username":"queuest","Pw":"that user’s password"}'
```

The response's `AccessToken` field is the token. It stays valid until you sign that device out under **Dashboard → Devices**.

### 5. Connect in Queuest

In **Settings → Media Server**, enter the `https://….ts.net` address (no port) and the token, then choose **Connect and check**. Queuest runs a first check right away. If it fails, nothing is saved and you'll see why. If it works, you'll see how many movies and shows it found and how many queue titles it marked.

Repeat this on each device you want to run the check from. The connection is saved per device.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| "The address must start with https://." | Use the `https://….ts.net` address from `tailscale serve status`, not the server's IP or `http://` address. |
| "Only Tailscale addresses (ending in .ts.net) are supported." | Same as above. Queuest can only reach `.ts.net` addresses. |
| "Couldn't reach your Jellyfin server." | Is this device connected to Tailscale right now? Does the address open Jellyfin in a browser tab? Did you leave off `:8096`? |
| "Jellyfin rejected the token." | The API key was deleted, or the user's token was signed out under **Dashboard → Devices**. Create a new one. |
| The browser asks to allow access to devices on your local network | Some browsers ask before a site can reach a private address, including Tailscale's. Allow it for Queuest. |
| A title you have isn't marked | Matching uses the TMDB or IMDb ID Jellyfin has for the item. If Jellyfin matched it to the wrong title, or has no ID for it, fix the item's metadata in Jellyfin (**Identify**) and check again. |

## Privacy notes

- Nothing about your queue is sent to Jellyfin. Queuest only asks for Jellyfin's list of movies and shows, and does the matching on your device.
- HTTPS certificates are recorded in public certificate-transparency logs. Enabling HTTPS certificates makes your machine name and tailnet name (for example `your-server.your-tailnet.ts.net`) publicly visible. The server itself stays reachable only from your tailnet.
