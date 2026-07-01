// Vercel serverless entrypoint.
//
// Vercel treats files under /api as serverless functions. We simply re-export
// the Express app; because process.env.VERCEL is set in this environment, the
// app skips app.listen() and the in-process polling timer, and is instead
// invoked per-request by the platform. The /api/(.*) rewrite in vercel.json
// forwards every API path here while the built client is served as static
// files from client/dist.
import app from '../server/index.js';

export default app;
