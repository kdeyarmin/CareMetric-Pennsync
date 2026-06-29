export const OASIS_GUIDANCE = {
  m0069: {
    description: "Determines if patient has a terminal prognosis affecting care planning and hospice eligibility.",
    scenarios: [
      {
        title: "Terminal Cancer Patient",
        description: "Patient has stage IV lung cancer with metastases. Oncologist has documented 6-month prognosis. Patient receiving palliative care only.",
        recommendedAnswer: "1 — Yes (terminal prognosis)",
        color: "#ef4444"
      },
      {
        title: "Chronic Heart Failure",
        description: "Patient with NYHA Class IV heart failure, frequent hospitalizations, but cardiologist has not documented terminal prognosis.",
        recommendedAnswer: "0 — No (unless physician specifically documents <12 months)",
        color: "#3557b0"
      },
      {
        title: "End-Stage COPD",
        description: "Patient on continuous oxygen, minimal activity tolerance, pulmonologist has documented 'end-stage' but no specific timeframe given.",
        recommendedAnswer: "0 — No (requires specific prognosis documentation)",
        color: "#3557b0"
      }
    ],
    howToAnswer: [
      "Review physician orders and clinical notes for explicit prognosis statements",
      "Look for phrases like 'life expectancy less than 12 months' or 'terminal diagnosis'",
      "Do not assume terminal status based on severity alone",
      "Physician certification is required for 'Yes' response",
      "Consider hospice eligibility criteria if documented"
    ],
    redFlags: [
      "Patient appears very ill but no physician documentation of prognosis",
      "Family states 'he's dying' but no medical documentation",
      "Multiple comorbidities but no terminal diagnosis documented"
    ],
    bestPractices: [
      "Always verify with attending physician if unclear",
      "Document exact source of prognosis (physician note, hospice certification, etc.)",
      "Update if patient's condition changes significantly",
      "Coordinate with hospice team if applicable"
    ],
    complianceTips: [
      "Medicare requires physician certification for terminal status",
      "Documentation must support the response",
      "Changes in prognosis must be communicated to care team"
    ]
  },

  m1020: {
    description: "Primary diagnosis that is the main reason for current home health admission.",
    scenarios: [
      {
        title: "Post-Surgical Hip Replacement",
        description: "Patient admitted after total hip replacement. Also has diabetes and hypertension managed with medications.",
        recommendedAnswer: "6 — Orthopedic (Hip/Knee) as this is the reason for admission",
        color: "#264491"
      },
      {
        title: "CHF Exacerbation with Comorbidities",
        description: "Patient admitted due to acute CHF exacerbation requiring IV diuretics. Has history of COPD and diabetes.",
        recommendedAnswer: "2 — Heart Failure / CHF as primary reason for admission",
        color: "#264491"
      },
      {
        title: "Diabetic Foot Ulcer",
        description: "Patient with poorly controlled diabetes admitted primarily for wound care of stage 3 diabetic foot ulcer.",
        recommendedAnswer: "5 — Wound / Pressure Ulcer (ulcer is primary focus of care)",
        color: "#264491"
      }
    ],
    howToAnswer: [
      "Identify THE main reason patient needs skilled home health services NOW",
      "Review physician referral and orders",
      "Focus on acute condition, not chronic comorbidities",
      "Consider what drove the referral to home health",
      "Primary diagnosis must require skilled nursing intervention"
    ],
    redFlags: [
      "Selecting chronic condition when acute issue drove admission",
      "Choosing diagnosis that doesn't require skilled care",
      "Multiple diagnoses listed without clear primary focus"
    ],
    bestPractices: [
      "Verify diagnosis with ICD-10 codes in referral",
      "Ensure diagnosis supports need for skilled services",
      "Document why this diagnosis is primary in clinical notes",
      "Align with physician's plan of care"
    ],
    complianceTips: [
      "Primary diagnosis must support medical necessity",
      "Must match physician certification and orders",
      "Affects PDGM payment grouping"
    ]
  },

  m1730: {
    description: "PHQ-2 depression screening assesses mood changes in last 2 weeks.",
    scenarios: [
      {
        title: "Recently Widowed Patient",
        description: "Patient lost spouse 3 weeks ago. Reports crying daily, no interest in hobbies, feeling hopeless. Answers 'yes' to both PHQ-2 questions.",
        recommendedAnswer: "2 — Yes to both questions (positive screen requiring follow-up)",
        color: "#ef4444"
      },
      {
        title: "Post-Stroke Depression",
        description: "Stroke patient reports feeling down 'several days' but still enjoys visits from grandchildren and watching TV.",
        recommendedAnswer: "1 — Yes to one question (positive screen)",
        color: "#f59e0b"
      },
      {
        title: "Well-Adjusted Patient",
        description: "Patient reports good mood, engaged in activities, looking forward to recovery. No depression symptoms.",
        recommendedAnswer: "0 — No (negative screen)",
        color: "#10b981"
      }
    ],
    howToAnswer: [
      "Ask exact PHQ-2 questions: 'Little interest or pleasure in doing things?' and 'Feeling down, depressed, or hopeless?'",
      "Timeframe is 'over the last 2 weeks'",
      "Patient self-report is primary source",
      "Any 'yes' response triggers positive screen",
      "Positive screen requires further assessment (PHQ-9)"
    ],
    redFlags: [
      "Patient endorses both questions - immediate mental health assessment needed",
      "Suicidal ideation mentioned - emergency psychiatric evaluation",
      "Caregiver reports significant mood changes patient denies"
    ],
    bestPractices: [
      "Use exact PHQ-2 wording for consistency",
      "Document patient's responses verbatim",
      "Positive screen triggers care plan intervention",
      "Follow up with full PHQ-9 if indicated",
      "Notify physician of positive screens"
    ],
    complianceTips: [
      "Medicare requires depression screening",
      "Positive screens must have documented follow-up",
      "Must be addressed in plan of care"
    ]
  },

  m1860: {
    description: "Assesses patient's current ability to walk safely once standing.",
    scenarios: [
      {
        title: "Post-Hip Surgery with Walker",
        description: "Patient had hip replacement 2 weeks ago. Uses walker, walks 50 feet with mild fatigue. Physical therapy twice weekly.",
        recommendedAnswer: "3 — Requires two-handed device (walker)",
        color: "#f59e0b"
      },
      {
        title: "Stroke with Hemiparesis",
        description: "Patient has left-sided weakness from stroke. Uses quad cane in right hand, can walk to bathroom (15 feet) but needs supervision.",
        recommendedAnswer: "2 — Requires one-handed device (cane)",
        color: "#f59e0b"
      },
      {
        title: "Bedbound Patient",
        description: "Patient is bedfast due to severe weakness. Cannot stand or ambulate. Hospice patient with terminal diagnosis.",
        recommendedAnswer: "5 — Unable to ambulate; bedfast",
        color: "#ef4444"
      }
    ],
    howToAnswer: [
      "Assess patient's CURRENT ability (day of assessment)",
      "Focus on what patient CAN do, not restrictions",
      "Assistive devices count (cane = one-handed, walker = two-handed)",
      "Consider safety and fall risk",
      "Wheelchair users: assess if they use wheelchair OR can ambulate"
    ],
    redFlags: [
      "Patient uses walker but coded as 'independent' - underscoring",
      "Safety concerns noted but not reflected in scoring",
      "Recent falls not considered in assessment"
    ],
    bestPractices: [
      "Observe patient ambulating during visit",
      "Document distance patient can safely walk",
      "Note any assistive devices used",
      "Address fall risk if impaired",
      "Include PT/OT if mobility limitations present"
    ],
    complianceTips: [
      "Must match functional limitation in plan of care",
      "Affects PDGM functional scoring",
      "Safety concerns must trigger interventions"
    ]
  },

  m1910: {
    description: "Fall history assessment identifies patients at high risk requiring prevention interventions.",
    scenarios: [
      {
        title: "Multiple Falls with Injury",
        description: "Patient fell 3 times in past 6 months. Last fall resulted in hip fracture requiring hospitalization. Now very fearful of falling.",
        recommendedAnswer: "2 — Two or more falls (high risk)",
        color: "#ef4444"
      },
      {
        title: "Single Fall with Minor Injury",
        description: "Patient tripped on rug 4 months ago, sustained minor bruising on arm. No other falls in past year. Still mobile and active.",
        recommendedAnswer: "1 — One fall or any fall with injury",
        color: "#f59e0b"
      },
      {
        title: "No Recent Falls",
        description: "Patient has not fallen in over 2 years. Uses assistive devices appropriately. Home safety assessment completed.",
        recommendedAnswer: "0 — No falls in past year",
        color: "#10b981"
      }
    ],
    howToAnswer: [
      "Count falls in the past 12 months",
      "ANY fall resulting in injury automatically scores at least '1'",
      "Include falls that didn't result in medical treatment",
      "Ask patient AND caregiver for complete history",
      "'Near falls' or 'catching self' do not count unless actual fall occurred"
    ],
    redFlags: [
      "Patient minimizes fall history - interview caregiver separately",
      "Frequent 'near misses' suggest imminent fall risk",
      "Environmental hazards present (rugs, poor lighting, clutter)"
    ],
    bestPractices: [
      "Complete comprehensive fall risk assessment",
      "Implement fall prevention interventions immediately",
      "Home safety evaluation if any falls reported",
      "PT evaluation for gait/balance if indicated",
      "Document fall prevention education provided"
    ],
    complianceTips: [
      "Positive fall history requires documented prevention plan",
      "Must include patient/caregiver education",
      "Interventions must be in place before next visit"
    ]
  },

  m2001: {
    description: "Drug regimen review identifies medication-related issues requiring follow-up.",
    scenarios: [
      {
        title: "Duplicate Medications Found",
        description: "Patient taking two different blood pressure medications prescribed by different doctors. Total daily dose exceeds recommended maximum. BP measurements too low.",
        recommendedAnswer: "1 — Issues found, physician contacted within 24 hours",
        color: "#f59e0b"
      },
      {
        title: "No Issues Identified",
        description: "Complete medication reconciliation performed. All medications appropriate for diagnoses, no duplications, no interactions. Patient adherent.",
        recommendedAnswer: "0 — No issues found during review",
        color: "#10b981"
      },
      {
        title: "High-Risk Drug Without Monitoring",
        description: "Patient on warfarin without recent INR check. Last INR 6 weeks ago. Issue identified but couldn't reach physician same day.",
        recommendedAnswer: "2 — Issues found, physician not contacted (requires follow-up)",
        color: "#ef4444"
      }
    ],
    howToAnswer: [
      "Complete comprehensive medication review within 48 hours of admission",
      "Check for duplications, interactions, contraindications",
      "Verify medications match current diagnoses",
      "Assess for high-risk medications requiring monitoring",
      "Document attempts to contact physician if issues found"
    ],
    redFlags: [
      "Patient on multiple high-risk drugs without monitoring",
      "Expired medications still being taken",
      "Medications that don't match current diagnoses",
      "Patient confused about medication regimen"
    ],
    bestPractices: [
      "Use pharmacy records and medication bottles for accuracy",
      "Include over-the-counter and supplements in review",
      "Document medication education provided",
      "Create medication list for patient/caregiver",
      "Establish system for ongoing monitoring"
    ],
    complianceTips: [
      "Medicare requires medication review within 48 hours",
      "Issues must be documented and followed to resolution",
      "Physician notification must be documented with date/time"
    ]
  },

  m1830: {
    description: "Assesses patient's ability to wash entire body safely, excluding grooming.",
    scenarios: [
      {
        title: "Independent with Shower Chair",
        description: "Patient uses shower chair and long-handled sponge. Bathes independently 3 times per week. No assistance needed.",
        recommendedAnswer: "0 — Able to bathe self independently (adaptive equipment is OK)",
        color: "#10b981"
      },
      {
        title: "Needs Setup and Supervision",
        description: "Caregiver sets up shower, adjusts water temperature, and stays nearby for safety. Patient washes self but needs help with back and feet.",
        recommendedAnswer: "2 — With partial person assistance; patient performs part",
        color: "#f59e0b"
      },
      {
        title: "Total Dependence - Bed Bath",
        description: "Bedbound patient. Caregiver provides complete bed bath. Patient unable to participate in any aspect of bathing.",
        recommendedAnswer: "4 — Unable to bathe self; total person assistance",
        color: "#ef4444"
      }
    ],
    howToAnswer: [
      "Focus on CURRENT ability, not what patient could do before",
      "Adaptive equipment use is considered independent",
      "Consider safety - if supervision needed for safety, not independent",
      "Partial assistance = patient does some, caregiver does some",
      "Rate worst performance if ability varies"
    ],
    redFlags: [
      "Patient states independent but caregiver reports otherwise",
      "Safety concerns (falls in shower) not reflected in score",
      "Patient hasn't bathed in weeks - may indicate depression or decline"
    ],
    bestPractices: [
      "Interview both patient and caregiver",
      "Observe bathroom setup for safety",
      "Document specific assistance required",
      "Address hygiene as ADL goal if dependent",
      "OT evaluation if adaptive equipment needed"
    ],
    complianceTips: [
      "Must match functional status in plan of care",
      "Total dependence requires rationale documentation",
      "Safety issues must trigger interventions"
    ]
  },

  m1400: {
    description: "Assesses shortness of breath or difficulty breathing at rest or with activity.",
    scenarios: [
      {
        title: "COPD with Exertional Dyspnea",
        description: "Patient with COPD on home oxygen 2L. Short of breath when walking to bathroom (20 feet). Comfortable at rest with oxygen.",
        recommendedAnswer: "2 — Short of breath with moderate exertion",
        color: "#f59e0b"
      },
      {
        title: "CHF with Rest Dyspnea",
        description: "Heart failure patient. Reports waking up at night gasping for air. Short of breath even sitting in chair. Sleeps propped on 3 pillows.",
        recommendedAnswer: "4 — Short of breath at rest",
        color: "#ef4444"
      },
      {
        title: "No Respiratory Issues",
        description: "Patient walks throughout house without difficulty. No oxygen requirement. No complaints of shortness of breath.",
        recommendedAnswer: "0 — Not short of breath",
        color: "#10b981"
      }
    ],
    howToAnswer: [
      "Assess dyspnea DURING the visit, not just patient report",
      "Note oxygen requirements and settings",
      "Observe patient during activity if possible",
      "Consider worst dyspnea in past 14 days if documented",
      "Rate based on symptoms WITH current interventions (oxygen, medications)"
    ],
    redFlags: [
      "Respiratory rate >24 at rest with dyspnea complaints",
      "Oxygen saturation dropping below 88% with minimal activity",
      "Using accessory muscles or pursed-lip breathing",
      "Inability to speak full sentences due to breathlessness"
    ],
    bestPractices: [
      "Document respiratory rate, oxygen saturation, and oxygen delivery rate",
      "Assess breath sounds bilaterally",
      "Note any cough, sputum production, or wheezing",
      "Implement respiratory interventions immediately if severe",
      "Contact physician if acute change from baseline"
    ],
    complianceTips: [
      "Significant dyspnea requires skilled respiratory interventions",
      "Must be addressed in plan of care with specific goals",
      "Changes from baseline warrant physician notification"
    ]
  },

  m1242: {
    description: "Assesses how often patient experiences pain requiring intervention.",
    scenarios: [
      {
        title: "Constant Post-Surgical Pain",
        description: "Patient 1 week post-op from hip replacement. Reports pain 'all the time' rated 6-7/10. Taking prescribed opioids around the clock.",
        recommendedAnswer: "3 — Constant pain (requires aggressive pain management)",
        color: "#ef4444"
      },
      {
        title: "Daily Arthritis Pain",
        description: "Patient with osteoarthritis reports daily knee pain, worse with activity. Usually rates 4-5/10. Takes acetaminophen most days.",
        recommendedAnswer: "2 — Daily but not constantly",
        color: "#f59e0b"
      },
      {
        title: "Occasional Discomfort",
        description: "Patient reports mild back discomfort 2-3 times per week, usually relieved with positioning. No pain medications needed.",
        recommendedAnswer: "1 — Pain less often than daily",
        color: "#f59e0b"
      }
    ],
    howToAnswer: [
      "Use patient's self-report - pain is what patient says it is",
      "Assess frequency over past 5 days",
      "Consider both day and night pain",
      "Include pain at rest AND with movement",
      "Document location, intensity (0-10 scale), and characteristics"
    ],
    redFlags: [
      "Patient reports constant pain but no pain management in place",
      "Pain intensity increasing despite interventions",
      "Pain limiting functional activities significantly",
      "Signs of inadequate pain control (grimacing, guarding, limited mobility)"
    ],
    bestPractices: [
      "Complete comprehensive pain assessment (OPQRST)",
      "Document pain management plan including non-pharmacologic interventions",
      "Reassess pain at every visit",
      "Contact physician if pain not adequately controlled",
      "Educate on proper use of pain medications"
    ],
    complianceTips: [
      "Frequent pain requires documented pain management plan",
      "Must show progress toward pain reduction goals",
      "Uncontrolled pain may indicate need for physician intervention"
    ]
  }
};