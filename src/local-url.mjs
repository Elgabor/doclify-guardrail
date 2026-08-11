function decodeLocalPath(url) {
  const encodedPath = String(url).split('#', 1)[0].split('?', 1)[0];
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

export { decodeLocalPath };
