#!/bin/bash
# Azure WebJob script to process the indexing queue
# This script is called by Azure on a schedule (see settings.job)
#
# Deploy: Zip run.sh + settings.job, upload to Azure Portal -> App Service -> WebJobs

set -e

echo "$(date): Starting queue processing..."

# Azure WebJobs run from a temp directory, so use absolute path to the app root
APP_ROOT="/home/site/wwwroot"
node "$APP_ROOT/dist/process-queue.js"

echo "$(date): Queue processing complete"
