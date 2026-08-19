# name=DEPLOYMENT_README.md
This branch (deploy/fly) contains deployment helpers for running TheVelora on Fly.io using Docker and a persistent volume for SQLite.

Recommended local steps (run these from your machine):

1. Install flyctl and log in
   - curl -L https://fly.io/install.sh | sh
   - fly auth login

2. Launch the app (no deploy yet). Replace <your-app-name> with a name you like (must be unique on Fly):
   - fly launch --name <your-app-name> --no-deploy

3. Create a persistent volume (choose region, e.g. sfo, iad, fra):
   - fly volumes create velora-data --size 1 --region <region>

4. Set required secrets (example):
   - fly secrets set JWT_SECRET="your_jwt_secret"
   - Optional: set SMTP_* and TWILIO_* if you use email/SMS features.

5. Deploy
   - fly deploy

6. Verify
   - Open the assigned URL or run: fly status
   - Check health: https://<your-app-hostname>/api/health

Notes
- The app stores the SQLite DB at /app/data/velora.db (server/db.js uses ../data). The fly volume is mounted to /app/data to persist it.
- If you want to test locally with Docker:
  - docker build -t velora .
  - mkdir -p ./data
  - docker run --rm -it -p 3000:3000 -v $(pwd)/data:/app/data -e JWT_SECRET="devsecret" velora
  - Visit http://localhost:3000

If you want, I can now:
- Open a PR from deploy/fly to main with these files (so you can review) and leave deployment to you, or
- Attempt a remote deploy step (I cannot run flyctl from here; you'll need to run the fly commands shown) — tell me which.
