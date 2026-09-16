# Application-wide function and page index — September 16, 2026

This appendix enumerates every backend entry, every non-test page, and every entity schema found in the checked-out source. Mentioned-name tests and literal call sites are static associations, not path coverage. The no-session response column comes from an isolated synthetic SDK run with actual provider calls blocked.

## Backend entries — 282

| Backend function | Source lines | Mentioning test files | Literal callers | Isolated no-session status | Explicit false flags |
| --- | ---: | ---: | ---: | ---: | --- |
| acceptAiContentAgreement | 251 | 2 | 1 | 401 | No false literal detected |
| adminResetPassword | 286 | 5 | 0 | 403 | No false literal detected |
| analyzeAndGenerateClinicalTasks | 257 | 2 | 1 | 401 | No false literal detected |
| analyzeClinicalData | 20 | 1 | 0 | 503 | No false literal detected |
| analyzeClinicalEvents | 247 | 0 | 0 | 401 | No false literal detected |
| analyzeClinicalRisks | 334 | 1 | 1 | 409 | CLINICAL_RISK_AI_ENABLED |
| analyzeClinicalTrends | 295 | 0 | 0 | 401 | No false literal detected |
| analyzeDocument | 13 | 1 | 1 | 503 | No false literal detected |
| analyzeFaxContent | 267 | 1 | 0 | 401 | No false literal detected |
| analyzeFaxPriority | 165 | 1 | 0 | 401 | No false literal detected |
| analyzeNurseDeficits | 349 | 1 | 1 | 401 | No false literal detected |
| analyzeNursePerformance | 13 | 2 | 0 | 503 | No false literal detected |
| analyzeOASISNarrativeMatch | 21 | 1 | 0 | 409 | No false literal detected |
| analyzeRealTimePerformance | 281 | 0 | 0 | 401 | No false literal detected |
| analyzeReferral | 243 | 0 | 0 | 401 | No false literal detected |
| analyzeReferralIntake | 129 | 0 | 1 | 401 | No false literal detected |
| analyzeReferralPriority | 83 | 0 | 1 | 401 | No false literal detected |
| analyzeVisitForSupplyUsage | 348 | 0 | 1 | 401 | No false literal detected |
| appendPatientNoteHistory | 666 | 4 | 2 | 401 | No false literal detected |
| archiveSignedDocument | 11 | 2 | 0 | 503 | No false literal detected |
| assignAnnualLearningPlan | 280 | 3 | 1 | 403 | No false literal detected |
| assignInService | 308 | 0 | 1 | 403 | No false literal detected |
| auditDataQuality | 254 | 0 | 0 | 403 | No false literal detected |
| autoApproveInvitedUser | 358 | 8 | 0 | 401 | No false literal detected |
| autoAssignNurseToPatient | 9 | 1 | 0 | 200 | No false literal detected |
| autoAssignWorkNumbers | 244 | 3 | 1 | 401 | No false literal detected |
| autoEndDutyDay | 194 | 1 | 0 | 401 | No false literal detected |
| autoEnrollAnnualPlans | 368 | 2 | 1 | 401 | No false literal detected |
| autoImportPatients | 137 | 0 | 0 | 401 | No false literal detected |
| autoRetryFailedFaxes | 985 | 9 | 0 | 503 | No false literal detected |
| awardBadgeOnCompletion | 335 | 4 | 0 | 401 | No false literal detected |
| backfillTcpaQuietHours | 63 | 1 | 1 | 403 | No false literal detected |
| batchAIAnalysis | 365 | 1 | 0 | 409 | BATCH_CLINICAL_AI_ENABLED, PDGM_REIMBURSEMENT_ENABLED |
| bulkCreateDocumentPackages | 11 | 2 | 0 | 503 | No false literal detected |
| calculateDataQualityScores | 205 | 1 | 0 | 503 | No false literal detected |
| calculatePDGM | 1354 | 7 | 1 | 409 | PDGM_REIMBURSEMENT_ENABLED |
| cancelScheduledSms | 121 | 2 | 0 | 401 | No false literal detected |
| cancelTimeOffRequest | 364 | 2 | 1 | 401 | No false literal detected |
| centralAdminRead | 547 | 0 | 0 | 503 | No false literal detected |
| centralLearningGrade | 197 | 1 | 0 | 503 | No false literal detected |
| checkAdrDeadlines | 207 | 2 | 0 | 401 | No false literal detected |
| checkAllIntegrations | 619 | 3 | 2 | 401 | No false literal detected |
| checkExpiredInvitations | 363 | 3 | 0 | 401 | No false literal detected |
| checkPendingSignatureRequests | 5 | 1 | 0 | 503 | No false literal detected |
| checkStaleFollowUpRequests | 657 | 5 | 0 | 503 | No false literal detected |
| cleanupExpiredCertificateCache | 84 | 1 | 0 | 403 | No false literal detected |
| cleanupProductionBootstrapArtifacts | 5 | 0 | 0 | 410 | No false literal detected |
| computeOutcomeMeasures | 7 | 6 | 0 | 503 | No false literal detected |
| computeOutcomeMeasuresV2 | 2284 | 6 | 1 | 503 | No false literal detected |
| createAuthorizedDocument | 1110 | 5 | 2 | 401 | No false literal detected |
| createAuthorizedPatient | 511 | 5 | 1 | 401 | No false literal detected |
| createAuthorizedVisit | 722 | 5 | 1 | 401 | No false literal detected |
| createNotification | 673 | 7 | 2 | 401 | No false literal detected |
| createTelehealthToken | 300 | 6 | 1 | 503 | No false literal detected |
| createUserWithTempPassword | 466 | 10 | 0 | 401 | No false literal detected |
| createUserWithTempPasswordV2 | 468 | 2 | 2 | 401 | No false literal detected |
| deduplicatePatients | 1338 | 5 | 1 | 503 | No false literal detected |
| deletePatientsMissingFirstName | 248 | 1 | 0 | 503 | No false literal detected |
| discoverTelnyxResources | 233 | 2 | 1 | 401 | No false literal detected |
| dispatchNightlyOutcomeMeasures | 388 | 4 | 0 | 503 | No false literal detected |
| dispatchScheduledSignatureReminders | 684 | 6 | 0 | 503 | SIGNATURE_REMINDER_DISPATCH_ENABLED |
| dispatchScheduledSms | 870 | 7 | 0 | 503 | No false literal detected |
| distributePolicyAcknowledgment | 266 | 0 | 1 | 403 | No false literal detected |
| duplicateInService | 185 | 2 | 1 | 403 | No false literal detected |
| embedAnnotationsToPDF | 12 | 2 | 0 | 503 | No false literal detected |
| enforceDataCompleteness | 258 | 1 | 0 | 503 | No false literal detected |
| enforceStaffRoleIntegrity | 135 | 3 | 0 | 401 | No false literal detected |
| ensureSuperAdmin | 85 | 2 | 1 | 401 | No false literal detected |
| expandClinicalPhrase | 330 | 1 | 1 | 401 | No false literal detected |
| exportLearningReportCSV | 314 | 0 | 0 | 403 | No false literal detected |
| extractClinicalDocument | 177 | 0 | 1 | 401 | No false literal detected |
| extractClinicalEvents | 423 | 0 | 0 | 401 | No false literal detected |
| extractFaxMetadataOCR | 99 | 0 | 1 | 401 | No false literal detected |
| extractPatientDataFromDocument | 124 | 0 | 1 | 401 | No false literal detected |
| extractReferralDataForSmartNote | 248 | 1 | 0 | 400 | No false literal detected |
| fetchMedicareGuideline | 161 | 0 | 1 | 403 | No false literal detected |
| fixUserAccount | 104 | 2 | 0 | 403 | No false literal detected |
| generateAIReport | 757 | 2 | 0 | 403 | No false literal detected |
| generateAdmissionNoteFromReferral | 91 | 1 | 0 | 409 | REFERRAL_ADMISSION_NOTE_AI_ENABLED |
| generateAdrPacket | 524 | 2 | 1 | 401 | No false literal detected |
| generateAndCacheCertificatePacket | 281 | 1 | 0 | 401 | No false literal detected |
| generateBagTechniquePDF | 209 | 0 | 0 | 401 | No false literal detected |
| generateCarePlanFromReferral | 121 | 2 | 0 | 409 | REFERRAL_CARE_PLAN_DRAFT_ENABLED |
| generateCarePlanSuggestions | 334 | 2 | 0 | 409 | CARE_PLAN_SUGGESTIONS_AI_ENABLED |
| generateCarePlansFromReferral | 304 | 2 | 0 | 409 | REFERRAL_CARE_PLAN_AI_ENABLED |
| generateCertificatePacketPDF | 256 | 0 | 0 | 401 | No false literal detected |
| generateComprehensiveOASISReport | 278 | 1 | 0 | 409 | PDGM_REIMBURSEMENT_ENABLED, COMPREHENSIVE_OASIS_REPORT_ENABLED |
| generateComprehensiveReport | 446 | 1 | 0 | 409 | COMPREHENSIVE_REPORT_ENABLED |
| generateCourseQuiz | 291 | 2 | 1 | 403 | No false literal detected |
| generateDischargeSummary | 28 | 3 | 0 | 503 | No false literal detected |
| generateDocumentPackageFromTemplate | 11 | 2 | 0 | 503 | No false literal detected |
| generateDynamicCoverSheet | 248 | 0 | 0 | 401 | No false literal detected |
| generateFaxCoverPage | 664 | 2 | 1 | 401 | No false literal detected |
| generateFollowUpPortalToken | 495 | 3 | 1 | 400 | No false literal detected |
| generateFollowUpTasks | 219 | 1 | 1 | 401 | No false literal detected |
| generateLearningTranscriptPDF | 369 | 1 | 1 | 401 | No false literal detected |
| generateMessageSuggestions | 502 | 2 | 0 | 503 | No false literal detected |
| generateNoteFromRecording | 304 | 0 | 1 | 401 | No false literal detected |
| generateOASISAssessment | 297 | 1 | 1 | 409 | OASIS_ASSESSMENT_AI_ENABLED |
| generateOASISReportPDF | 285 | 1 | 1 | 409 | OASIS_REPORT_PDF_ENABLED |
| generatePDGMComparisonPDF | 39 | 1 | 1 | 409 | PDGM_REIMBURSEMENT_ENABLED |
| generatePDGMNavigatorPDF | 40 | 1 | 1 | 409 | PDGM_REIMBURSEMENT_ENABLED |
| generatePatientChartPDF | 215 | 2 | 0 | 401 | No false literal detected |
| generatePatientEducation | 29 | 3 | 0 | 503 | No false literal detected |
| generatePatientHandout | 836 | 2 | 1 | 401 | No false literal detected |
| generatePersonalizedLearningPath | 262 | 1 | 1 | 401 | No false literal detected |
| generatePersonalizedTraining | 299 | 1 | 0 | 401 | No false literal detected |
| generateReferralOASISPacket | 1194 | 1 | 2 | 401 | No false literal detected |
| generateReferralTasks | 93 | 0 | 0 | 401 | No false literal detected |
| generateSignatureCertificate | 11 | 2 | 0 | 503 | No false literal detected |
| generateSignerToken | 631 | 4 | 0 | 503 | PUBLIC_SIGNATURE_RELEASE_ENABLED |
| generateSkillAssessmentPDF | 242 | 0 | 0 | 401 | No false literal detected |
| generateSmartNoteGuide | 479 | 0 | 0 | 401 | No false literal detected |
| generateTrainingCertificate | 209 | 1 | 1 | 401 | No false literal detected |
| generateTrainingCertificatePDF | 336 | 0 | 2 | 401 | No false literal detected |
| generateTrainingCourse | 889 | 4 | 1 | 403 | No false literal detected |
| generateUserGuidePDF | 726 | 0 | 0 | 401 | No false literal detected |
| generateUserManual | 1307 | 0 | 1 | 401 | No false literal detected |
| generateUserRosterPDF | 278 | 0 | 0 | 401 | No false literal detected |
| getAiContentAgreementStatus | 171 | 2 | 1 | 401 | No false literal detected |
| getApprovedTimeOff | 164 | 1 | 1 | 401 | No false literal detected |
| getAuthorizedDocument | 1108 | 5 | 3 | 400 | No false literal detected |
| getAuthorizedInboundReferralFax | 276 | 2 | 1 | 401 | No false literal detected |
| getAuthorizedPatient | 816 | 4 | 1 | 400 | No false literal detected |
| getAuthorizedPatientNoteHistory | 566 | 4 | 1 | 401 | No false literal detected |
| getAuthorizedVisit | 1034 | 4 | 1 | 400 | No false literal detected |
| getCommsDashboard | 361 | 0 | 1 | 403 | No false literal detected |
| getCourseFeedbackSummary | 47 | 0 | 1 | 401 | No false literal detected |
| getCoursePlayerQuestions | 83 | 1 | 1 | 401 | No false literal detected |
| getDashboardData | 221 | 3 | 1 | 401 | No false literal detected |
| getMyTenantContext | 588 | 10 | 2 | 401 | No false literal detected |
| getMyTrainingGamification | 85 | 1 | 1 | 401 | No false literal detected |
| getPDGMRateConfig | 11 | 2 | 0 | 409 | No false literal detected |
| getPatientContext | 13 | 3 | 0 | 410 | No false literal detected |
| getPublishedOutcomeMeasures | 966 | 1 | 1 | 401 | No false literal detected |
| getScopedPatientAlerts | 235 | 5 | 4 | 401 | No false literal detected |
| getTeamTrainingReadiness | 258 | 3 | 1 | 401 | No false literal detected |
| getTelnyxSecretStatus | 97 | 2 | 2 | 401 | No false literal detected |
| getUserActivityLog | 14 | 1 | 0 | 503 | No false literal detected |
| gradeMemoryBooster | 110 | 0 | 1 | 401 | No false literal detected |
| gradeTrainingAttempt | 638 | 4 | 1 | 401 | No false literal detected |
| handleTelnyxStatusWebhook | 2937 | 10 | 0 | 503 | No false literal detected |
| importProvidersCsv | 331 | 1 | 1 | 403 | No false literal detected |
| indexPDF | 288 | 2 | 0 | 401 | No false literal detected |
| issueCertificate | 325 | 0 | 1 | 401 | No false literal detected |
| listAuthorizedDocuments | 1032 | 4 | 1 | 400 | No false literal detected |
| listAuthorizedPatients | 1404 | 8 | 1 | 400 | No false literal detected |
| listAuthorizedVisits | 1380 | 7 | 1 | 400 | No false literal detected |
| listCompetencies | 85 | 1 | 1 | 401 | No false literal detected |
| listMyTenantMemberships | 497 | 2 | 1 | 401 | No false literal detected |
| listOASISUploads | 89 | 1 | 3 | 409 | OASIS_UPLOAD_LIST_ENABLED |
| listPolicyLibrary | 71 | 1 | 1 | 401 | No false literal detected |
| listTenantTrainingIntegrityRecords | 310 | 1 | 1 | 401 | No false literal detected |
| manageAgencyMembership | 733 | 2 | 1 | 401 | No false literal detected |
| manageAuthorizedReferral | 1275 | 10 | 5 | 400 | No false literal detected |
| manageMyNotifications | 515 | 2 | 1 | 400 | No false literal detected |
| managePatientCareTeamAssignment | 1282 | 4 | 1 | 400 | CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED |
| managePhoneNumberPool | 338 | 5 | 1 | 401 | No false literal detected |
| manageSmsConsent | 644 | 5 | 1 | 401 | No false literal detected |
| manageTrainingVideos | 380 | 5 | 1 | 403 | No false literal detected |
| manageUserVerification | 193 | 2 | 0 | 403 | No false literal detected |
| manageVehicleMaintenance | 505 | 2 | 1 | 400 | No false literal detected |
| mapNoteToOASIS | 479 | 2 | 1 | 409 | NOTE_TO_OASIS_MAPPING_ENABLED |
| markMessageRead | 557 | 1 | 0 | 503 | No false literal detected |
| matchPatientWithAI | 206 | 0 | 1 | 401 | No false literal detected |
| mergePDFs | 125 | 2 | 4 | 401 | No false literal detected |
| messagingAssistant | 34 | 2 | 0 | 503 | No false literal detected |
| migrateExistingData | 242 | 1 | 0 | 503 | No false literal detected |
| monitorClinicalDataForCarePlanUpdates | 507 | 2 | 0 | 503 | No false literal detected |
| monitorComplianceRisks | 459 | 3 | 0 | 409 | COMPLIANCE_RISK_MONITOR_ENABLED |
| notifyAdminOfSignedDocument | 11 | 2 | 0 | 503 | No false literal detected |
| notifySignerOfPackage | 11 | 1 | 0 | 503 | No false literal detected |
| notifyUrgentMessage | 538 | 2 | 0 | 503 | No false literal detected |
| offboardUser | 1081 | 3 | 3 | 401 | No false literal detected |
| onDocumentSigned | 11 | 2 | 0 | 503 | No false literal detected |
| onUserSignup | 554 | 5 | 0 | 400 | No false literal detected |
| policyAcknowledgment | 207 | 0 | 1 | 401 | No false literal detected |
| pollFaxStatuses | 1635 | 8 | 0 | 503 | No false literal detected |
| predictPatientRisks | 444 | 1 | 0 | 503 | No false literal detected |
| predictSupplyNeeds | 272 | 0 | 0 | 401 | No false literal detected |
| predictiveRiskAnalysis | 480 | 3 | 1 | 503 | No false literal detected |
| preflightStagingReadinessFixture | 665 | 2 | 0 | 503 | No false literal detected |
| preparePDFWithPatientInfo | 347 | 2 | 0 | 401 | No false literal detected |
| processAnnualEducationRenewals | 187 | 1 | 0 | 401 | No false literal detected |
| processCompletedVisit | 449 | 2 | 0 | 503 | No false literal detected |
| processDischargeReport | 321 | 2 | 0 | 503 | No false literal detected |
| processFaxOCR | 300 | 0 | 0 | 401 | No false literal detected |
| processInboundFaxes | 1405 | 7 | 0 | 503 | No false literal detected |
| processOASISBatch | 331 | 1 | 1 | 409 | OASIS_BATCH_AI_ENABLED |
| processPatientFileUpdate | 629 | 2 | 2 | 401 | No false literal detected |
| processScheduledFaxes | 718 | 6 | 1 | 503 | No false literal detected |
| processScheduledFaxesByPriority | 130 | 3 | 0 | 401 | No false literal detected |
| processTrainingRenewals | 191 | 1 | 0 | 401 | No false literal detected |
| provisionNurseWorkNumber | 230 | 4 | 1 | 401 | No false literal detected |
| rankDiagnosesByPDGM | 45 | 1 | 0 | 409 | PDGM_REIMBURSEMENT_ENABLED |
| readAuthorizedOASISAssessments | 1133 | 2 | 1 | 400 | No false literal detected |
| rebuildExistingInServices | 331 | 2 | 0 | 403 | No false literal detected |
| recordSmsConsent | 592 | 5 | 0 | 401 | No false literal detected |
| recordTrainingAuditEvent | 117 | 2 | 1 | 401 | No false literal detected |
| redriveFailedSms | 697 | 6 | 0 | 503 | No false literal detected |
| remindPlanOverdueStaff | 247 | 1 | 1 | 403 | No false literal detected |
| reorderDeletePDFPages | 131 | 1 | 1 | 401 | No false literal detected |
| resendInvitation | 259 | 6 | 0 | 401 | No false literal detected |
| resendInvitationV2 | 260 | 1 | 1 | 401 | No false literal detected |
| resetUserPassword | 316 | 6 | 1 | 403 | No false literal detected |
| retrainOCRModel | 306 | 1 | 1 | 403 | No false literal detected |
| retryFailedFax | 254 | 6 | 1 | 400 | No false literal detected |
| reviewPersonnelCredential | 438 | 3 | 1 | 401 | No false literal detected |
| reviewTimeOffRequest | 379 | 2 | 1 | 401 | No false literal detected |
| reviewTimesheet | 379 | 2 | 1 | 401 | No false literal detected |
| rotateTelehealthJoinToken | 198 | 2 | 1 | 401 | No false literal detected |
| runSecurityAudit | 14 | 3 | 0 | 503 | No false literal detected |
| saveAnnotatedPDF | 169 | 1 | 1 | 401 | No false literal detected |
| saveFollowUpRuleConfig | 206 | 2 | 1 | 403 | No false literal detected |
| saveOasisResponses | 1394 | 4 | 0 | 503 | No false literal detected |
| savePDGMRateConfig | 14 | 2 | 1 | 409 | No false literal detected |
| savePayerRateConfig | 272 | 2 | 1 | 409 | PAYER_RATE_CONFIG_ENABLED |
| savePayrollProfile | 225 | 1 | 1 | 401 | No false literal detected |
| saveTelnyxSecret | 188 | 3 | 1 | 401 | No false literal detected |
| saveVisitPointConfig | 193 | 1 | 1 | 401 | No false literal detected |
| scheduleSignatureReminders | 499 | 3 | 0 | 503 | SIGNATURE_REMINDER_RELEASE_ENABLED |
| scheduleSms | 208 | 4 | 1 | 503 | No false literal detected |
| scheduledGuidelineSync | 289 | 1 | 1 | 401 | No false literal detected |
| searchPDFs | 305 | 2 | 1 | 401 | No false literal detected |
| searchPurchaseTelnyxNumbers | 516 | 6 | 2 | 401 | No false literal detected |
| seedAnnualMandatoryEducationSamples | 575 | 2 | 0 | 403 | No false literal detected |
| seedYearlyRequiredInServices | 1829 | 2 | 1 | 403 | No false literal detected |
| selfEnrollCourse | 196 | 1 | 1 | 401 | No false literal detected |
| sendAccountReadyEmail | 302 | 2 | 0 | 403 | No false literal detected |
| sendAuthorizedReferralFax | 1232 | 8 | 4 | 401 | No false literal detected |
| sendAutomatedSignatureReminders | 5 | 1 | 0 | 503 | No false literal detected |
| sendBatchFax | 1906 | 8 | 2 | 400 | No false literal detected |
| sendCredentialRenewalReminders | 548 | 3 | 0 | 401 | No false literal detected |
| sendDocumentReminderEmails | 5 | 1 | 0 | 503 | No false literal detected |
| sendExpirationNotifications | 283 | 1 | 0 | 401 | No false literal detected |
| sendFax | 452 | 15 | 4 | 401 | No false literal detected |
| sendFaxStatusNotification | 785 | 6 | 0 | 401 | No false literal detected |
| sendMessage | 679 | 4 | 0 | 503 | No false literal detected |
| sendPersonnelExpirationNotifications | 498 | 3 | 0 | 401 | No false literal detected |
| sendRenewalReminders | 246 | 1 | 0 | 401 | No false literal detected |
| sendSignatureReminder | 5 | 1 | 0 | 503 | No false literal detected |
| sendSms | 1178 | 11 | 1 | 401 | No false literal detected |
| sendTestSms | 660 | 7 | 1 | 401 | No false literal detected |
| sendTrainingCertificateEmail | 478 | 2 | 0 | 401 | No false literal detected |
| sendTrainingNotifications | 268 | 1 | 0 | 401 | No false literal detected |
| sendWelcomeEmail | 244 | 2 | 0 | 403 | No false literal detected |
| setNurseDutyStatus | 179 | 1 | 1 | 401 | No false literal detected |
| signatureIntegrity | 11 | 2 | 0 | 503 | No false literal detected |
| splitReferralPDF | 124 | 0 | 1 | 401 | No false literal detected |
| stampSignatureOnPDF | 11 | 2 | 0 | 503 | No false literal detected |
| startMaskedCall | 434 | 9 | 3 | 401 | No false literal detected |
| startTrainingAssignment | 174 | 1 | 1 | 401 | No false literal detected |
| submitCourseFeedback | 95 | 0 | 1 | 401 | No false literal detected |
| submitDocumentSignatures | 12 | 1 | 0 | 503 | No false literal detected |
| submitFollowUpResponse | 901 | 6 | 1 | 400 | No false literal detected |
| submitIncidentReport | 263 | 2 | 2 | 401 | No false literal detected |
| submitPersonnelCredential | 454 | 4 | 2 | 401 | No false literal detected |
| submitScenarioAttempt | 283 | 1 | 1 | 401 | No false literal detected |
| submitSignerSignature | 1023 | 4 | 0 | 503 | PUBLIC_SIGNATURE_RELEASE_ENABLED |
| submitStateReportableIncident | 536 | 4 | 1 | 401 | No false literal detected |
| submitTimeOffRequest | 482 | 3 | 1 | 401 | No false literal detected |
| submitTimesheet | 782 | 4 | 1 | 401 | No false literal detected |
| summarizeMessageThread | 504 | 2 | 0 | 503 | No false literal detected |
| syncCMSRegulations | 155 | 0 | 0 | 403 | No false literal detected |
| syncFaxStatuses | 340 | 3 | 0 | 401 | No false literal detected |
| syncTrainingVideoStatuses | 131 | 3 | 0 | 401 | No false literal detected |
| testAutomations | 77 | 0 | 1 | 403 | No false literal detected |
| testTelnyxConnection | 367 | 3 | 3 | 401 | No false literal detected |
| trackUserLogin | 11 | 1 | 0 | 503 | No false literal detected |
| transcribeAndGenerateSOAPNote | 128 | 1 | 1 | 401 | No false literal detected |
| transcribeAudioWithWhisper | 105 | 0 | 2 | 401 | No false literal detected |
| triageReferralWithAI | 115 | 1 | 1 | 401 | No false literal detected |
| triggerCorrectiveActionPlan | 438 | 3 | 0 | 401 | No false literal detected |
| updateAuthorizedPatient | 1037 | 2 | 1 | 401 | No false literal detected |
| updateAuthorizedVisit | 1430 | 6 | 1 | 401 | No false literal detected |
| updateIncident | 382 | 4 | 1 | 401 | No false literal detected |
| updateScopedPatientAlert | 122 | 1 | 2 | 401 | No false literal detected |
| userManagement | 955 | 12 | 0 | 401 | No false literal detected |
| userManagementV2 | 956 | 2 | 1 | 401 | No false literal detected |
| validateFollowUpToken | 444 | 5 | 1 | 400 | No false literal detected |
| validatePatientData | 180 | 0 | 0 | 401 | No false literal detected |
| validateSignerToken | 549 | 4 | 0 | 503 | PUBLIC_SIGNATURE_RELEASE_ENABLED |

The one HTTP 200 is the documented inert `autoAssignNurseToPatient` retirement stub; it did not read or write any data. The Telnyx signed-webhook handler attempted only its verification-configuration lookup, which the synthetic SDK blocked. All other detected I/O would fail this audit. Environment-gated responses are not evidence of actual hosted configuration.

## Non-test page components — 87

| Page | Source lines | Mentioning test files |
| --- | ---: | ---: |
| ADRCenter | 535 | 1 |
| AIComplianceInServices | 22 | 0 |
| AIToolsCenter | 57 | 0 |
| AITrainingGenerator | 366 | 0 |
| About | 139 | 0 |
| AdminOperations | 148 | 3 |
| AdminTraining | 330 | 1 |
| AdminTrainingAnalytics | 300 | 2 |
| AdminUserSetup | 247 | 1 |
| AgencyAnalytics | 404 | 4 |
| AgencySettings | 331 | 15 |
| AnalyticsDashboard | 523 | 2 |
| AutomaticCarePlans | 15 | 2 |
| BulkDischargeImport | 26 | 1 |
| CarePlanBuilder | 15 | 1 |
| CarePlanManagement | 15 | 2 |
| ClinicalChart | 8 | 3 |
| ClinicalDocumentation | 118 | 2 |
| ClinicalInsightsDashboard | 145 | 2 |
| ClinicalLibrary | 64 | 0 |
| ClinicalPathwayManager | 839 | 2 |
| CommsDashboard | 261 | 0 |
| ComplianceCenter | 710 | 3 |
| CredentialCompliance | 25 | 0 |
| Dashboard | 395 | 11 |
| DocumentHub | 236 | 2 |
| DocumentationImpact | 648 | 1 |
| DuplicatePatients | 536 | 4 |
| EducationLibrary | 350 | 2 |
| EventReport | 462 | 1 |
| FacilityDocumentationRules | 18 | 0 |
| Features | 1530 | 2 |
| Help | 568 | 6 |
| IncidentReportingModule | 785 | 0 |
| IncidentReview | 23 | 1 |
| Incidents | 79 | 2 |
| JoinTelehealth | 37 | 5 |
| LearningCenter | 1579 | 2 |
| LearningReports | 125 | 0 |
| ManagerSkillGapDashboard | 135 | 0 |
| MedicareGuidelinesLibrary | 547 | 1 |
| Messages | 34 | 6 |
| MyLearning | 182 | 2 |
| NotificationSettings | 77 | 1 |
| NurseEducationVideos | 224 | 2 |
| NursePerformanceDashboard | 19 | 1 |
| NurseTrainingHub | 340 | 3 |
| OASISCenter | 225 | 4 |
| OAuthConsent | 280 | 2 |
| OnCallSchedule | 153 | 1 |
| PDFSearch | 19 | 0 |
| PDFTools | 36 | 0 |
| PDGMRateSettings | 580 | 0 |
| PatientAlerts | 211 | 3 |
| PatientDataManagement | 807 | 3 |
| PatientDetails | 276 | 14 |
| PatientEducationHub | 728 | 0 |
| PatientRecordDashboard | 528 | 4 |
| Patients | 666 | 14 |
| PersonnelFile | 138 | 1 |
| PhoneCenter | 134 | 1 |
| PhysicianDirectory | 19 | 1 |
| PredictiveAnalytics | 215 | 2 |
| PrivacyPolicy | 155 | 3 |
| ProviderFollowUpPortal | 303 | 4 |
| ReferralFollowUp | 1219 | 10 |
| ReferralIntake | 2097 | 6 |
| ReferralTriage | 300 | 2 |
| ReportsAnalytics | 152 | 1 |
| ResourceLibrary | 50 | 0 |
| SendFax | 249 | 2 |
| SignDocument | 25 | 1 |
| SignerPortal | 38 | 4 |
| SmartNoteAssistant | 1282 | 6 |
| SuperAdminConfig | 238 | 1 |
| SystemJobMonitor | 375 | 0 |
| Telehealth | 31 | 7 |
| TemplateLibrary | 217 | 1 |
| TemplateManagement | 329 | 1 |
| TimeOff | 173 | 1 |
| Timesheets | 273 | 3 |
| TrainingCoursePlayer | 897 | 4 |
| UserActivityReport | 19 | 0 |
| UserGuides | 492 | 3 |
| UserManagement | 1027 | 4 |
| UserSettings | 943 | 2 |
| VehicleMaintenance | 200 | 1 |

## Entity schemas — 253

| Entity | Declared fields | Required fields | Direct client CRUD entirely denied in source |
| --- | ---: | ---: | --- |
| AIConfiguration | 24 | 1 | Conditional — inspect policy |
| AIContentAgreementAttestation | 6 | 6 | Yes |
| AIFeedback | 10 | 3 | Conditional — inspect policy |
| AIInsightFeedback | 13 | 3 | Yes |
| AIKnowledgeBase | 15 | 3 | Yes |
| AILearningPattern | 11 | 3 | Yes |
| AIModelConfiguration | 16 | 3 | Yes |
| AIModelTestResult | 12 | 3 | Conditional — inspect policy |
| AdrAuditCase | 26 | 0 | Conditional — inspect policy |
| Agency | 30 | 2 | Conditional — inspect policy |
| AgencyComplianceRule | 10 | 3 | Yes |
| AgencyFeatureAccess | 4 | 3 | Conditional — inspect policy |
| AgencyInvitation | 9 | 2 | Conditional — inspect policy |
| AgencyInvoice | 17 | 5 | Conditional — inspect policy |
| AgencyKPI | 25 | 5 | Yes |
| AgencyMembership | 16 | 12 | Yes |
| AgencyMessage | 29 | 5 | Yes |
| AgencySettings | 331 | 0 | Conditional — inspect policy |
| AlertTriggerRule | 17 | 4 | Yes |
| Announcement | 7 | 2 | Conditional — inspect policy |
| AnomalyAlert | 9 | 2 | Conditional — inspect policy |
| AppliedDataLog | 11 | 6 | Conditional — inspect policy |
| AppointmentForm | 13 | 5 | Yes |
| ApprovalRequest | 18 | 4 | Conditional — inspect policy |
| ArchivedRecord | 12 | 4 | Conditional — inspect policy |
| AuditTrail | 8 | 3 | Conditional — inspect policy |
| AutomaticCarePlanTrigger | 11 | 5 | Yes |
| BIIntegration | 10 | 4 | Conditional — inspect policy |
| Billing | 31 | 4 | Yes |
| CallLog | 19 | 1 | Conditional — inspect policy |
| CareCoordinationAlert | 17 | 5 | Yes |
| CarePlan | 12 | 3 | Yes |
| CarePlanProposal | 17 | 5 | Conditional — inspect policy |
| CareSetting | 18 | 4 | Yes |
| CertificatePacketCache | 9 | 4 | Yes |
| CitationLibrary | 10 | 2 | Yes |
| ClinicalEvent | 18 | 4 | Yes |
| ClinicalLibraryFolder | 6 | 1 | Conditional — inspect policy |
| ClinicalLibraryTemplate | 14 | 3 | Conditional — inspect policy |
| ClinicalPathway | 20 | 2 | Yes |
| ClinicalScenario | 12 | 3 | Yes |
| Competency | 7 | 3 | Yes |
| ComplianceAudit | 15 | 4 | Conditional — inspect policy |
| ComplianceRule | 13 | 4 | Conditional — inspect policy |
| ComplianceTrainingProgress | 13 | 2 | Conditional — inspect policy |
| ComplianceViolation | 20 | 4 | Conditional — inspect policy |
| ContentScopeBinding | 12 | 11 | Yes |
| CorrectiveActionPlan | 12 | 4 | Conditional — inspect policy |
| CustomValidationRule | 8 | 4 | Conditional — inspect policy |
| DataArchivePolicy | 12 | 3 | Conditional — inspect policy |
| DigitalSignature | 18 | 5 | Yes |
| DischargeSummary | 27 | 3 | Conditional — inspect policy |
| Document | 23 | 2 | Yes |
| DocumentAnalysisHistory | 9 | 2 | Conditional — inspect policy |
| DocumentAutomationWorkflow | 16 | 3 | Yes |
| DocumentPackage | 31 | 3 | Yes |
| DocumentPackageToken | 34 | 4 | Yes |
| DocumentRecord | 16 | 5 | Conditional — inspect policy |
| DocumentSignature | 52 | 2 | Yes |
| DocumentSignatureTemplate | 10 | 4 | Yes |
| DocumentTemplate | 17 | 3 | Conditional — inspect policy |
| DocumentTenantBinding | 22 | 19 | Yes |
| DocumentVersion | 18 | 7 | Yes |
| DocumentationTemplate | 7 | 3 | Yes |
| EducationMaterial | 13 | 3 | Conditional — inspect policy |
| EmbedConfig | 14 | 3 | Conditional — inspect policy |
| EmployeePayrollProfile | 7 | 1 | Conditional — inspect policy |
| FaceToFaceEncounter | 16 | 0 | Conditional — inspect policy |
| FacilityDocumentationRule | 12 | 3 | Conditional — inspect policy |
| FaxContact | 10 | 3 | Conditional — inspect policy |
| FaxContactGroup | 6 | 2 | Conditional — inspect policy |
| FaxCoverTemplate | 11 | 2 | Yes |
| FaxDocument | 19 | 3 | Yes |
| FaxDocumentTemplate | 9 | 4 | Conditional — inspect policy |
| FaxDraft | 10 | 1 | Conditional — inspect policy |
| FaxFolder | 7 | 2 | Conditional — inspect policy |
| FaxHistory | 24 | 3 | Yes |
| FaxLog | 76 | 2 | Conditional — inspect policy |
| FaxNotification | 8 | 4 | Yes |
| FaxPriorityRule | 8 | 5 | Yes |
| FaxRetryConfig | 8 | 0 | Conditional — inspect policy |
| FaxTemplate | 12 | 1 | Conditional — inspect policy |
| FeaturePackage | 10 | 4 | Yes |
| FeatureToggle | 5 | 3 | Conditional — inspect policy |
| FleetServiceEntry | 21 | 11 | Yes |
| FleetServiceReview | 10 | 10 | Yes |
| FleetVehicle | 20 | 8 | Yes |
| FollowUpRuleConfig | 5 | 0 | Conditional — inspect policy |
| FormTemplate | 6 | 3 | Yes |
| GeneratedDocument | 14 | 4 | Conditional — inspect policy |
| HealthRecord | 20 | 4 | Conditional — inspect policy |
| Immunization | 15 | 3 | Conditional — inspect policy |
| Incident | 29 | 3 | Conditional — inspect policy |
| IncomingFax | 42 | 13 | Yes |
| InsuranceProvider | 8 | 3 | Yes |
| IntegrationSecret | 10 | 1 | Conditional — inspect policy |
| InterventionLog | 24 | 5 | Conditional — inspect policy |
| InvitationSettings | 3 | 0 | Yes |
| Invoice | 18 | 7 | Conditional — inspect policy |
| Leaderboard | 11 | 1 | Yes |
| LearnedFormatPattern | 11 | 2 | Conditional — inspect policy |
| LearningPlan | 14 | 3 | Conditional — inspect policy |
| LearningPlanCourse | 7 | 2 | Conditional — inspect policy |
| LibraryDocument | 7 | 3 | Conditional — inspect policy |
| MaterialInteraction | 10 | 3 | Yes |
| MedicalCode | 15 | 5 | Conditional — inspect policy |
| MedicareComplianceRule | 17 | 5 | Conditional — inspect policy |
| MedicareGuideline | 15 | 4 | Conditional — inspect policy |
| Medication | 14 | 6 | Yes |
| MedicationReconciliation | 21 | 2 | Yes |
| Message | 41 | 0 | Yes |
| MessageTemplate | 13 | 4 | Yes |
| MicroLearningProgress | 12 | 4 | Conditional — inspect policy |
| NewFeature | 6 | 2 | Yes |
| NoteConversion | 16 | 1 | Conditional — inspect policy |
| NoteFeedback | 14 | 2 | Conditional — inspect policy |
| NoteTemplate | 8 | 4 | Yes |
| Notification | 23 | 4 | Yes |
| NotificationPreference | 8 | 1 | Conditional — inspect policy |
| NotificationPreferences | 9 | 1 | Conditional — inspect policy |
| NotificationRule | 11 | 4 | Conditional — inspect policy |
| NurseGoal | 13 | 5 | Conditional — inspect policy |
| NursePerformanceMetric | 23 | 3 | Yes |
| NurseSkill | 8 | 3 | Conditional — inspect policy |
| OASISActionItem | 20 | 3 | Yes |
| OASISAssessment | 18 | 2 | Yes |
| OASISAudit | 33 | 3 | Yes |
| OASISAutomationRule | 9 | 3 | Yes |
| OASISFeedback | 21 | 0 | Yes |
| OASISScenario | 17 | 2 | Yes |
| OASISUpload | 24 | 1 | Conditional — inspect policy |
| OASISWorkflowExecution | 17 | 4 | Yes |
| OCRFeedback | 12 | 3 | Conditional — inspect policy |
| OCRTrainingSession | 15 | 1 | Conditional — inspect policy |
| OnCallShift | 8 | 2 | Conditional — inspect policy |
| OutcomeComputationRun | 22 | 13 | Yes |
| PDFIndex | 8 | 3 | Conditional — inspect policy |
| PDFTemplate | 16 | 3 | Conditional — inspect policy |
| PDGMCaseMix | 21 | 3 | Yes |
| PDGMRateConfig | 10 | 0 | Yes |
| Patient | 66 | 2 | Yes |
| PatientAlert | 21 | 4 | Conditional — inspect policy |
| PatientBillingInfo | 16 | 1 | Yes |
| PatientCareTeamAssignment | 23 | 20 | Yes |
| PatientDocument | 16 | 4 | Conditional — inspect policy |
| PatientEducationAssignment | 18 | 2 | Yes |
| PatientEducationDelivery | 17 | 3 | Yes |
| PatientEducationDraft | 15 | 4 | Yes |
| PatientEducationEngagement | 11 | 3 | Yes |
| PatientEducationMaterial | 16 | 2 | Yes |
| PatientMessage | 27 | 5 | Yes |
| PatientNoteHistoryEntry | 19 | 14 | Yes |
| PatientOutcome | 13 | 4 | Yes |
| PatientOutcomeMetric | 39 | 2 | Yes |
| PatientPathwayAssignment | 11 | 3 | Yes |
| PatientRecommendation | 17 | 5 | Yes |
| PatientRiskAssessment | 15 | 4 | Yes |
| PayerRateConfig | 8 | 0 | Conditional — inspect policy |
| Payment | 9 | 5 | Conditional — inspect policy |
| PaymentRecord | 8 | 4 | Conditional — inspect policy |
| PendingPatientUpdate | 11 | 3 | Conditional — inspect policy |
| PersonalizedLearningPath | 12 | 3 | Conditional — inspect policy |
| PersonnelCredential | 25 | 4 | Conditional — inspect policy |
| PhoneNumber | 7 | 1 | Conditional — inspect policy |
| Physician | 28 | 2 | Conditional — inspect policy |
| PhysicianAgencyProfile | 16 | 8 | Yes |
| PlanEnrollment | 13 | 2 | Conditional — inspect policy |
| PolicyAcknowledgment | 16 | 4 | Conditional — inspect policy |
| PolicyLibrary | 11 | 3 | Yes |
| ProductionMigrationCleanupReceipt | 3 | 3 | Yes |
| ProviderBadge | 7 | 3 | Conditional — inspect policy |
| ProviderCertification | 10 | 3 | Conditional — inspect policy |
| ProviderDashboardCustomization | 12 | 2 | Conditional — inspect policy |
| ProviderFacilityAssignment | 13 | 2 | Conditional — inspect policy |
| ProviderFollowUpToken | 29 | 20 | Yes |
| ProviderPatientAssignment | 11 | 2 | Conditional — inspect policy |
| ProviderPermission | 10 | 4 | Conditional — inspect policy |
| ProviderPracticeInfo | 15 | 2 | Conditional — inspect policy |
| ProviderPreferences | 9 | 2 | Conditional — inspect policy |
| ProviderSettings | 10 | 2 | Yes |
| ProviderSpecialization | 14 | 2 | Conditional — inspect policy |
| ProviderUsagePattern | 12 | 1 | Conditional — inspect policy |
| RealTimePerformanceMetric | 10 | 3 | Conditional — inspect policy |
| RecurringFax | 16 | 4 | Conditional — inspect policy |
| Referral | 50 | 6 | Yes |
| RegulatoryUpdate | 16 | 5 | Conditional — inspect policy |
| ReminderLog | 12 | 3 | Yes |
| ReportTemplate | 8 | 3 | Conditional — inspect policy |
| RiskAlert | 10 | 4 | Yes |
| RiskAnalysis | 9 | 3 | Yes |
| ScenarioAttempt | 12 | 3 | Conditional — inspect policy |
| ScheduleFeedback | 7 | 3 | Yes |
| ScheduledFax | 47 | 2 | Yes |
| ScheduledReport | 13 | 4 | Conditional — inspect policy |
| ScheduledSignatureReminder | 29 | 2 | Yes |
| ScheduledSms | 18 | 4 | Yes |
| SecurityLog | 7 | 3 | Yes |
| SentEducationMaterial | 11 | 3 | Conditional — inspect policy |
| ServiceCode | 7 | 4 | Yes |
| SessionTimeout | 6 | 2 | Conditional — inspect policy |
| SharedDocument | 14 | 3 | Yes |
| SharedPhraseLibrary | 7 | 3 | Yes |
| SignatureArtifactBinding | 24 | 23 | Yes |
| SignatureAuditEvent | 19 | 6 | Yes |
| SignerReviewGrant | 23 | 17 | Yes |
| SkillBadge | 9 | 2 | Yes |
| SkillGap | 12 | 4 | Conditional — inspect policy |
| SmsConsent | 18 | 2 | Yes |
| SmsMessage | 18 | 3 | Yes |
| StagingReadinessFixture | 14 | 14 | Yes |
| Subscription | 21 | 2 | Conditional — inspect policy |
| SubscriptionSettings | 10 | 0 | Yes |
| SuggestedIntervention | 16 | 4 | Yes |
| SupplyItem | 11 | 3 | Yes |
| SupplyLowStockAlert | 12 | 4 | Yes |
| SupplyPrediction | 13 | 4 | Yes |
| SupplyUsageLog | 11 | 3 | Yes |
| SystemHealthMetric | 9 | 5 | Conditional — inspect policy |
| SystemLog | 11 | 4 | Conditional — inspect policy |
| Task | 26 | 2 | Conditional — inspect policy |
| TeamMessage | 12 | 4 | Yes |
| TeamNote | 4 | 2 | Yes |
| TelecomDestinationBinding | 31 | 25 | Yes |
| TelehealthSession | 26 | 2 | Yes |
| TerminologyGlossary | 6 | 2 | Conditional — inspect policy |
| TermsAcceptanceAudit | 12 | 7 | Conditional — inspect policy |
| TimeOffRequest | 16 | 4 | Conditional — inspect policy |
| TimeSavings | 10 | 3 | Conditional — inspect policy |
| Timesheet | 29 | 4 | Conditional — inspect policy |
| TrainingAssignment | 46 | 2 | Conditional — inspect policy |
| TrainingAttempt | 21 | 3 | Conditional — inspect policy |
| TrainingAttestation | 9 | 7 | Conditional — inspect policy |
| TrainingAuditLog | 11 | 3 | Yes |
| TrainingCertificate | 23 | 4 | Conditional — inspect policy |
| TrainingCompletion | 15 | 3 | Conditional — inspect policy |
| TrainingCourse | 49 | 3 | Conditional — inspect policy |
| TrainingFeedback | 22 | 2 | Conditional — inspect policy |
| TrainingModule | 34 | 3 | Conditional — inspect policy |
| TrainingQuestion | 14 | 4 | Conditional — inspect policy |
| TrainingRecommendation | 9 | 4 | Conditional — inspect policy |
| TrainingTemplate | 8 | 2 | Conditional — inspect policy |
| TranscriptionLearning | 5 | 3 | Conditional — inspect policy |
| User | 43 | 6 | Conditional — inspect policy |
| UserActivity | 11 | 2 | Yes |
| UserBadge | 9 | 3 | Yes |
| UserFavorite | 5 | 4 | Conditional — inspect policy |
| UserInvitation | 15 | 4 | Conditional — inspect policy |
| UserLearnedPattern | 13 | 4 | Conditional — inspect policy |
| VerificationCode | 6 | 3 | Conditional — inspect policy |
| Visit | 42 | 3 | Yes |
| VisitPointConfig | 8 | 0 | Conditional — inspect policy |
| WorkflowDefinition | 8 | 4 | Conditional — inspect policy |
| WorkflowExecution | 10 | 4 | Conditional — inspect policy |
