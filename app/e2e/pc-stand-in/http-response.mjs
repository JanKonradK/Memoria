/**
 * Send a complete, framed rejection before closing an unfinished upload.
 * Ending the response immediately makes Node destroy its socket with unread
 * bytes, which can reset the connection and lose the response on Windows.
 * Discard a bounded amount while giving the sender time to read the response.
 */
export function rejectRequestBody(req, res, message, { headers = {}, limit = 1_000_000 } = {}) {
  const body = JSON.stringify({ error: message });
  res.writeHead(413, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'close',
    ...headers,
  });
  if (req.readableEnded) {
    res.end(body);
    return;
  }

  let discarded = 0;
  let finished = false;
  const discard = (chunk) => {
    discarded += chunk.length;
    if (discarded >= limit + req.readableHighWaterMark) req.pause();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    req.pause();
    req.off('data', discard);
    req.off('end', finish);
    res.off('close', finish);
    if (!res.destroyed) res.end();
  };
  const deadline = setTimeout(finish, 1000);
  deadline.unref();
  req.on('data', discard);
  req.once('end', finish);
  req.once('error', finish);
  res.once('close', finish);
  res.write(body);
  req.resume();
}
