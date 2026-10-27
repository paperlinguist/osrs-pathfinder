// Container HEALTHCHECK target — hits the app's own homepage.
fetch(`http://127.0.0.1:${process.env.PORT || 3000}/`)
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
