import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const readRepoFile = (filePath) => readFileSync(`${process.cwd()}/${filePath}`, 'utf8');

describe('iOS App Store wrapper guardrails', () => {
  it('declares required App Store privacy and hardware usage strings', () => {
    const plist = readRepoFile('ios/PennSync/Info.plist');
    expect(plist).toContain('NSCameraUsageDescription');
    expect(plist).toContain('NSMicrophoneUsageDescription');
    expect(plist).toContain('NSPhotoLibraryUsageDescription');
    expect(plist).toContain('NSPhotoLibraryAddUsageDescription');
    expect(plist).toContain('ITSAppUsesNonExemptEncryption');
  });

  it('handles App Store WKWebView link and popup behavior explicitly', () => {
    const webView = readRepoFile('ios/PennSync/WebViewController.swift');
    expect(webView).toContain('navigationAction.shouldPerformDownload');
    expect(webView).toContain('navigationAction.request.url?.scheme == "blob"');
    expect(webView).toContain('["tel", "mailto", "sms"]');
    expect(webView).toContain('createWebViewWith configuration');
    expect(webView).toContain('navigationAction.targetFrame == nil');
    expect(webView).toContain('runJavaScriptAlertPanelWithMessage');
    expect(webView).toContain('runJavaScriptConfirmPanelWithMessage');
  });

  it('only auto-grants media capture for the configured app origin', () => {
    const webView = readRepoFile('ios/PennSync/WebViewController.swift');
    expect(webView).toContain('requestMediaCapturePermission origin');
    expect(webView).toContain('origin.host == expectedHost');
    expect(webView).toContain('origin.`protocol` == expectedScheme');
    expect(webView).toContain('decisionHandler(.prompt)');
    expect(webView).toContain('decisionHandler(.grant)');
  });

  it('keeps internal training previews inside the installed app shell', () => {
    for (const filePath of ['src/components/training/CourseManager.jsx', 'src/components/training/SMEReviewQueue.jsx']) {
      const source = readRepoFile(filePath);
      expect(source).not.toMatch(/TrainingCoursePlayer[^\n]+target="_blank"/);
    }
  });
});
