import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const readRepoFile = (filePath) => readFileSync(`${process.cwd()}/${filePath}`, 'utf8');

describe('iOS App Store wrapper guardrails', () => {
  it('preserves the existing CareMetric AI store identities and production origin', () => {
    const project = readRepoFile('ios/project.yml');
    const webView = readRepoFile('ios/PennSync/WebViewController.swift');
    const plist = readRepoFile('ios/PennSync/Info.plist');
    const readme = readRepoFile('ios/README.md');
    const welcomeEmail = readRepoFile('base44/functions/createUserWithTempPassword/entry.ts');

    expect(project).toContain('PRODUCT_BUNDLE_IDENTIFIER: com.caremetric.ai');
    expect(project).not.toContain('PRODUCT_BUNDLE_IDENTIFIER: com.caremetric.pennsync');
    expect(webView).toContain('https://caremetricai.base44.app/');
    expect(webView).not.toContain('https://pennsync.base44.app/');
    expect(readme).toContain('https://caremetricai.base44.app/');
    expect(plist).toContain('<string>base44.app</string>');
    expect(plist).toContain('<string>base44.com</string>');
    expect(plist).not.toContain('<string>pennsync.base44.app</string>');
    // This spelling is the package ID of the existing Google Play listing.
    expect(welcomeEmail).toContain('play.google.com/store/apps/details?id=com.caremetic.ai');
  });

  it('retains the installable PWA identity and icon metadata', () => {
    const manifest = JSON.parse(readRepoFile('public/manifest.json'));
    const index = readRepoFile('index.html');
    const viteConfig = readRepoFile('vite.config.js');

    expect(manifest.id).toBe('.');
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '192x192', purpose: 'maskable' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]));
    expect(index).toContain('href="%BASE_URL%manifest.json"');
    expect(index).toContain('href="%BASE_URL%icons/icon-192.png"');
    expect(index).toContain('href="%BASE_URL%icons/apple-touch-icon.png"');
    expect(viteConfig).toContain("base: command === 'build' ? './' : '/'");
  });

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
