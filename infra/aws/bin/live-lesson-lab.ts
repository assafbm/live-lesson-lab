#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LiveLessonLabServerlessStack } from "../lib/live-lesson-lab-serverless-stack";

const app = new cdk.App();

// The CDK CLI fills these values from the selected AWS profile at synth/deploy time.
// Keeping account identity out of source means the same stack can be reviewed locally.
new LiveLessonLabServerlessStack(app, "LiveLessonLabServerlessStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  description: "Domain-free AWS serverless pilot for Live Lesson Lab"
});
