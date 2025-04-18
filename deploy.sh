#!/bin/bash

# Set variables
PROJECT_ID="breadwinner-415122"
REGION="us-central1"
REPO_NAME="opportunities"          
IMAGE_NAME="bbox-api"                  
IMAGE_TAG="latest"
FULL_IMAGE="us-central1-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$IMAGE_NAME:$IMAGE_TAG"

SERVICE_NAME="bbox-api"                

echo "🔑 Authenticating Docker with Artifact Registry..."
gcloud auth configure-docker us-central1-docker.pkg.dev

echo "🔨 Building Docker image..."
docker build --platform=linux/amd64 -t $FULL_IMAGE .

echo "📤 Pushing image to Artifact Registry..."
docker push $FULL_IMAGE

echo "🚀 Deploying Cloud Run service: $SERVICE_NAME"
gcloud run deploy $SERVICE_NAME \
  --image $FULL_IMAGE \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --cpu=4 \
  --memory=8Gi \
  --max-instances=1 \
  --timeout=900s \
  --port=8080