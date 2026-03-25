import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

const LOGO_URL = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/c39653ba3_PennHomeHealthInc.png';

// Interactive elements for handouts
const interactiveResources = {
  'chf': [
    { text: 'Heart Failure Society Patient Resources', url: 'https://www.hfsa.org/patient' },
    { text: 'American Heart Association - Heart Failure', url: 'https://www.heart.org/en/health-topics/heart-failure' }
  ],
  'copd': [
    { text: 'COPD Foundation Patient Resources', url: 'https://www.copdfoundation.org' },
    { text: 'American Lung Association - COPD', url: 'https://www.lung.org/lung-health-diseases/lung-disease-lookup/copd' }
  ],
  'diabetes': [
    { text: 'American Diabetes Association', url: 'https://www.diabetes.org' },
    { text: 'CDC Diabetes Resources', url: 'https://www.cdc.gov/diabetes' }
  ],
  'hypertension': [
    { text: 'American Heart Association - High Blood Pressure', url: 'https://www.heart.org/en/health-topics/high-blood-pressure' }
  ],
  'stroke': [
    { text: 'American Stroke Association', url: 'https://www.stroke.org' },
    { text: 'National Stroke Association Resources', url: 'https://www.stroke.org/en/about-stroke' }
  ]
};

const trackingChecklists = {
  'chf': [
    'I weigh myself daily at the same time',
    'I track my daily weight in my log',
    'I limit salt intake to less than 2g per day',
    'I take all medications as prescribed',
    'I elevate my legs when resting'
  ],
  'copd': [
    'I use my inhalers as prescribed',
    'I practice pursed-lip breathing daily',
    'I avoid lung irritants (smoke, dust)',
    'I do my breathing exercises',
    'I stay physically active'
  ],
  'diabetes': [
    'I check my blood sugar as directed',
    'I take my medications at the same time daily',
    'I inspect my feet daily',
    'I eat balanced meals',
    'I exercise 30 minutes most days'
  ],
  'hypertension': [
    'I take my blood pressure daily',
    'I log my blood pressure readings',
    'I limit sodium intake',
    'I take medications as prescribed',
    'I exercise regularly'
  ],
  'wound_care': [
    'I clean the wound as instructed',
    'I change dressings properly',
    'I check for signs of infection',
    'I keep the wound dry between changes',
    'I eat protein-rich foods for healing'
  ]
};

const handoutTemplates = {
  'chf': {
    title: 'Congestive Heart Failure (CHF)',
    sections: [
      {
        heading: 'What is CHF?',
        content: 'Congestive Heart Failure (CHF) occurs when your heart doesn\'t pump blood as well as it should. This causes fluid to build up in your lungs and other parts of your body.'
      },
      {
        heading: 'Warning Signs',
        bullets: [
          'Shortness of breath, especially when lying down',
          'Swelling in legs, ankles, or feet',
          'Rapid weight gain (2-3 pounds in a day)',
          'Persistent cough or wheezing',
          'Fatigue and weakness',
          'Irregular or rapid heartbeat'
        ]
      },
      {
        heading: 'Self-Care Tips',
        bullets: [
          'Weigh yourself daily at the same time',
          'Limit salt intake to less than 2 grams per day',
          'Limit fluid intake as directed by your doctor',
          'Take all medications as prescribed',
          'Elevate your legs when sitting',
          'Stay active with approved exercises'
        ]
      },
      {
        heading: 'When to Call Your Doctor',
        bullets: [
          'Weight gain of 2-3 pounds in one day or 5 pounds in a week',
          'Increased swelling in legs, ankles, or abdomen',
          'Increased shortness of breath',
          'New or worsening cough',
          'Difficulty sleeping due to breathing problems'
        ]
      },
      {
        heading: 'Emergency - Call 911 If:',
        bullets: [
          'Severe shortness of breath',
          'Chest pain or pressure',
          'Fainting or severe weakness',
          'Coughing up pink, frothy mucus'
        ]
      }
    ]
  },
  'copd': {
    title: 'Chronic Obstructive Pulmonary Disease (COPD)',
    sections: [
      {
        heading: 'What is COPD?',
        content: 'COPD is a chronic lung disease that makes it hard to breathe. It includes emphysema and chronic bronchitis. The airways become inflamed and narrowed, making it difficult to get air in and out of your lungs.'
      },
      {
        heading: 'Common Symptoms',
        bullets: [
          'Chronic cough with mucus',
          'Shortness of breath, especially during activities',
          'Wheezing',
          'Chest tightness',
          'Frequent respiratory infections',
          'Fatigue'
        ]
      },
      {
        heading: 'Managing Your COPD',
        bullets: [
          'STOP SMOKING - this is the most important step',
          'Use your inhalers exactly as prescribed',
          'Practice pursed-lip breathing',
          'Stay active with pulmonary rehabilitation',
          'Avoid lung irritants (smoke, dust, fumes)',
          'Get vaccinated (flu and pneumonia shots)'
        ]
      },
      {
        heading: 'Breathing Techniques',
        bullets: [
          'Pursed-lip breathing: Breathe in through nose, breathe out slowly through pursed lips',
          'Diaphragmatic breathing: Focus on belly breathing',
          'Take breaks during activities',
          'Use oxygen as prescribed'
        ]
      },
      {
        heading: 'Call Your Doctor If:',
        bullets: [
          'Increased shortness of breath',
          'Change in mucus color (yellow, green, or bloody)',
          'Increased cough or wheezing',
          'Fever over 100.4°F',
          'Confusion or extreme fatigue',
          'Chest pain'
        ]
      }
    ]
  },
  'diabetes': {
    title: 'Diabetes Management',
    sections: [
      {
        heading: 'Understanding Diabetes',
        content: 'Diabetes is a condition where your body cannot properly use or produce insulin, leading to high blood sugar levels. Managing your blood sugar is essential to prevent complications.'
      },
      {
        heading: 'Blood Sugar Targets',
        bullets: [
          'Before meals: 80-130 mg/dL',
          'Two hours after meals: Less than 180 mg/dL',
          'Bedtime: 100-140 mg/dL',
          'Your doctor may set different targets for you'
        ]
      },
      {
        heading: 'Daily Management',
        bullets: [
          'Check blood sugar as directed',
          'Take medications at the same time each day',
          'Eat regular, balanced meals',
          'Limit sugary foods and drinks',
          'Exercise regularly (30 minutes most days)',
          'Check your feet daily for cuts or sores'
        ]
      },
      {
        heading: 'Signs of Low Blood Sugar (Hypoglycemia)',
        bullets: [
          'Shaking or trembling',
          'Sweating',
          'Fast heartbeat',
          'Dizziness or lightheadedness',
          'Hunger',
          'Confusion or irritability',
          'TREAT IMMEDIATELY: 15g fast-acting carbs (juice, glucose tablets)'
        ]
      },
      {
        heading: 'Signs of High Blood Sugar (Hyperglycemia)',
        bullets: [
          'Increased thirst',
          'Frequent urination',
          'Blurred vision',
          'Fatigue',
          'Headache',
          'Slow-healing wounds'
        ]
      },
      {
        heading: 'Foot Care',
        bullets: [
          'Inspect feet daily for cuts, blisters, or redness',
          'Wash feet daily and dry thoroughly',
          'Never go barefoot',
          'Wear properly fitted shoes',
          'Trim toenails carefully',
          'Report any foot problems immediately'
        ]
      }
    ]
  },
  'hypertension': {
    title: 'High Blood Pressure (Hypertension)',
    sections: [
      {
        heading: 'What is High Blood Pressure?',
        content: 'High blood pressure occurs when the force of blood against your artery walls is too high. Often called the "silent killer," it usually has no symptoms but can lead to heart attack, stroke, and kidney disease.'
      },
      {
        heading: 'Blood Pressure Goals',
        bullets: [
          'Normal: Less than 120/80 mmHg',
          'Your target may be different based on your health',
          'Know your personal blood pressure goal'
        ]
      },
      {
        heading: 'Lifestyle Changes',
        bullets: [
          'Reduce sodium (salt) to less than 2,300mg per day',
          'Eat plenty of fruits, vegetables, and whole grains',
          'Limit alcohol consumption',
          'Quit smoking',
          'Maintain a healthy weight',
          'Exercise regularly (30 minutes most days)',
          'Manage stress through relaxation techniques'
        ]
      },
      {
        heading: 'Taking Your Blood Pressure at Home',
        bullets: [
          'Use a validated home blood pressure monitor',
          'Measure at the same time each day',
          'Sit quietly for 5 minutes before measuring',
          'Keep arm supported at heart level',
          'Take 2-3 readings, 1 minute apart',
          'Keep a log of your readings'
        ]
      },
      {
        heading: 'Medications',
        bullets: [
          'Take all medications as prescribed',
          'Don\'t stop medications without talking to your doctor',
          'Report side effects to your healthcare team',
          'Use a pill organizer to stay organized',
          'Refill prescriptions on time'
        ]
      },
      {
        heading: 'Call Your Doctor If:',
        bullets: [
          'Blood pressure is consistently above your target',
          'You experience side effects from medications',
          'Severe headache with blurred vision',
          'Chest pain or shortness of breath',
          'Nosebleeds that won\'t stop'
        ]
      }
    ]
  },
  'stroke': {
    title: 'Stroke Recovery and Prevention',
    sections: [
      {
        heading: 'What is a Stroke?',
        content: 'A stroke occurs when blood flow to part of the brain is blocked or a blood vessel bursts. Brain cells begin to die, which can cause lasting brain damage, disability, or death.'
      },
      {
        heading: 'Remember F.A.S.T.',
        bullets: [
          'F - Face drooping: Does one side of the face droop?',
          'A - Arm weakness: Is one arm weak or numb?',
          'S - Speech difficulty: Is speech slurred or hard to understand?',
          'T - Time to call 911: If you see any of these signs, call 911 immediately'
        ]
      },
      {
        heading: 'Recovery Tips',
        bullets: [
          'Attend all therapy sessions (physical, occupational, speech)',
          'Practice exercises at home as instructed',
          'Take medications to prevent another stroke',
          'Use assistive devices as recommended',
          'Ask for help when needed',
          'Be patient - recovery takes time'
        ]
      },
      {
        heading: 'Preventing Another Stroke',
        bullets: [
          'Control blood pressure',
          'Manage diabetes',
          'Lower cholesterol',
          'Quit smoking',
          'Eat a heart-healthy diet',
          'Exercise regularly',
          'Limit alcohol',
          'Take blood thinners as prescribed'
        ]
      },
      {
        heading: 'Safety at Home',
        bullets: [
          'Remove tripping hazards (rugs, cords)',
          'Install grab bars in bathroom',
          'Use non-slip mats in tub/shower',
          'Keep walkways clear and well-lit',
          'Wear non-slip footwear',
          'Keep frequently used items within easy reach'
        ]
      },
      {
        heading: 'Call 911 Immediately If:',
        bullets: [
          'New or worsening stroke symptoms',
          'Sudden severe headache',
          'Sudden vision changes',
          'Sudden trouble walking or balance problems',
          'Sudden confusion or trouble speaking'
        ]
      }
    ]
  },
  'wound_care': {
    title: 'Wound Care Instructions',
    sections: [
      {
        heading: 'Keeping Your Wound Clean',
        content: 'Proper wound care is essential for healing and preventing infection. Follow your nurse\'s instructions carefully.'
      },
      {
        heading: 'Daily Wound Care',
        bullets: [
          'Wash hands thoroughly before touching wound',
          'Clean wound as instructed by your nurse',
          'Apply dressings exactly as shown',
          'Keep wound dry between dressing changes',
          'Don\'t remove dressings unless instructed',
          'Dispose of used dressings in plastic bag'
        ]
      },
      {
        heading: 'Signs Your Wound is Healing',
        bullets: [
          'Wound is getting smaller',
          'Less drainage',
          'Pink or red tissue in wound bed',
          'Less pain',
          'No foul odor'
        ]
      },
      {
        heading: 'Signs of Infection - Call Your Nurse',
        bullets: [
          'Increased redness around wound',
          'Increased swelling',
          'Increased pain',
          'Warmth around wound',
          'Pus or cloudy drainage',
          'Foul odor',
          'Fever over 100.4°F',
          'Red streaks from wound',
          'Wound getting larger instead of smaller'
        ]
      },
      {
        heading: 'Promoting Healing',
        bullets: [
          'Eat a balanced diet with protein',
          'Stay hydrated - drink 6-8 glasses of water daily',
          'Take vitamins as prescribed',
          'Elevate affected area when possible',
          'Avoid smoking - it slows healing',
          'Keep blood sugar controlled if diabetic',
          'Follow weight-bearing restrictions'
        ]
      },
      {
        heading: 'Supplies',
        bullets: [
          'Keep enough supplies on hand',
          'Store in a clean, dry place',
          'Check expiration dates',
          'Reorder before running out',
          'Tell your nurse if supplies are low'
        ]
      }
    ]
  },
  'fall_prevention': {
    title: 'Fall Prevention at Home',
    sections: [
      {
        heading: 'Why Fall Prevention Matters',
        content: 'Falls are a leading cause of injury in older adults. Most falls happen at home. The good news is that many falls can be prevented with simple changes to your home and habits.'
      },
      {
        heading: 'Home Safety Checklist',
        bullets: [
          'Remove throw rugs or secure with non-slip backing',
          'Keep floors clear of clutter, cords, and small objects',
          'Install grab bars in bathroom (tub, shower, toilet)',
          'Use non-slip mats in tub and shower',
          'Ensure good lighting in all rooms and hallways',
          'Use nightlights in bedroom, bathroom, and hallways',
          'Keep stairways clear and well-lit',
          'Install handrails on both sides of stairs',
          'Secure loose carpeting',
          'Store frequently used items within easy reach'
        ]
      },
      {
        heading: 'Personal Safety',
        bullets: [
          'Wear non-slip, well-fitting footwear',
          'Don\'t wear loose clothing that can cause tripping',
          'Use assistive devices (cane, walker) as prescribed',
          'Rise slowly from sitting or lying position',
          'Don\'t rush - take your time',
          'Turn on lights before entering a room',
          'Use step stool with handle, never stand on chairs',
          'Keep phone within reach',
          'Consider a medical alert system'
        ]
      },
      {
        heading: 'Medications and Falls',
        bullets: [
          'Some medications can cause dizziness or drowsiness',
          'Review all medications with your doctor',
          'Be extra careful when starting new medications',
          'Don\'t mix alcohol with medications',
          'Stand up slowly if medications cause dizziness'
        ]
      },
      {
        heading: 'Stay Strong and Active',
        bullets: [
          'Exercise regularly to maintain strength and balance',
          'Practice balance exercises as recommended',
          'Stay active but know your limits',
          'Have vision checked yearly',
          'Eat a healthy diet to maintain bone strength',
          'Get adequate calcium and vitamin D'
        ]
      },
      {
        heading: 'If You Do Fall',
        bullets: [
          'Stay calm',
          'Check for injuries before getting up',
          'Roll to your side, push up to hands and knees',
          'Crawl to sturdy furniture and pull yourself up',
          'Rest before resuming activities',
          'Call for help if you can\'t get up',
          'Tell your doctor about all falls'
        ]
      }
    ]
  },
  'pain_management': {
    title: 'Pain Management',
    sections: [
      {
        heading: 'Understanding Pain',
        content: 'Pain is your body\'s way of signaling that something needs attention. Managing pain effectively helps you heal, stay active, and maintain quality of life.'
      },
      {
        heading: 'Describing Your Pain',
        content: 'Help your healthcare team understand your pain by describing:',
        bullets: [
          'Location: Where exactly does it hurt?',
          'Intensity: On a scale of 0-10, how severe is it?',
          'Quality: Sharp, dull, burning, aching, shooting?',
          'Timing: Constant or comes and goes?',
          'What makes it better or worse?',
          'How it affects your daily activities'
        ]
      },
      {
        heading: 'Medication Safety',
        bullets: [
          'Take pain medication as prescribed',
          'Don\'t wait until pain is severe - stay ahead of it',
          'Take with food if it upsets your stomach',
          'Don\'t mix with alcohol',
          'Store medications safely away from children',
          'Dispose of unused medications properly',
          'Tell your doctor about all medications you take',
          'Report side effects immediately'
        ]
      },
      {
        heading: 'Non-Drug Pain Relief',
        bullets: [
          'Apply ice for acute injuries (first 48 hours)',
          'Apply heat for chronic pain or muscle tension',
          'Practice deep breathing and relaxation',
          'Try meditation or guided imagery',
          'Use distraction (music, TV, reading)',
          'Gentle exercise or stretching',
          'Massage',
          'Position changes',
          'Rest when needed'
        ]
      },
      {
        heading: 'When to Call Your Doctor',
        bullets: [
          'Pain is not controlled with prescribed medications',
          'New or different pain',
          'Pain interferes with sleep or daily activities',
          'Side effects from pain medications',
          'Signs of infection (fever, redness, swelling)',
          'Chest pain or shortness of breath',
          'Severe abdominal pain'
        ]
      }
    ]
  },
  'ckd': {
    title: 'Chronic Kidney Disease (CKD)',
    sections: [
      {
        heading: 'What is Chronic Kidney Disease?',
        content: 'Chronic Kidney Disease means your kidneys are damaged and can\'t filter blood the way they should. This can cause waste to build up in your body and lead to other health problems.',
        highlight: true
      },
      {
        heading: 'Understanding Your Stage',
        content: 'CKD has 5 stages based on how well your kidneys work:',
        bullets: [
          'Stage 1-2: Mild kidney damage with normal or slightly reduced function',
          'Stage 3: Moderate kidney damage (3A mild to moderate, 3B moderate to severe)',
          'Stage 4: Severe kidney damage - prepare for kidney replacement therapy',
          'Stage 5: Kidney failure - dialysis or transplant needed'
        ]
      },
      {
        heading: 'Managing Your Diet',
        subsections: [
          {
            subheading: 'Protein',
            bullets: ['Moderate protein intake as directed by your dietitian', 'Choose high-quality proteins (chicken, fish, eggs)']
          },
          {
            subheading: 'Sodium',
            bullets: ['Limit to 2,000mg or less per day', 'Avoid processed and canned foods', 'Use herbs and spices instead of salt']
          },
          {
            subheading: 'Potassium',
            bullets: ['May need to limit high-potassium foods (bananas, oranges, potatoes)', 'Ask your doctor if potassium restriction is needed']
          },
          {
            subheading: 'Phosphorus',
            bullets: ['Limit dairy, nuts, beans, and dark sodas', 'Take phosphate binders with meals as prescribed']
          }
        ]
      },
      {
        heading: 'Daily Management',
        bullets: [
          'Take all medications exactly as prescribed',
          'Monitor blood pressure daily',
          'Stay hydrated unless fluid restricted',
          'Exercise regularly (30 minutes most days)',
          'Avoid NSAIDs (ibuprofen, naproxen) - use acetaminophen instead',
          'Keep all doctor appointments and lab tests'
        ]
      },
      {
        heading: 'Warning Signs - Call Your Doctor',
        important: true,
        bullets: [
          'Swelling in legs, ankles, feet, or face',
          'Shortness of breath',
          'Extreme fatigue or weakness',
          'Nausea, vomiting, loss of appetite',
          'Changes in urination (amount, color, frequency)',
          'Confusion or difficulty concentrating',
          'Chest pain or pressure',
          'Persistent itching'
        ]
      }
    ]
  },
  'osteoporosis': {
    title: 'Osteoporosis and Bone Health',
    sections: [
      {
        heading: 'Understanding Osteoporosis',
        content: 'Osteoporosis is a condition where bones become weak and brittle, making them more likely to break from minor falls or even simple activities like coughing or bending.',
        highlight: true
      },
      {
        heading: 'Risk Factors You Can\'t Change',
        bullets: [
          'Age over 50',
          'Female gender (especially after menopause)',
          'Family history of osteoporosis or fractures',
          'Small body frame',
          'Previous fracture after age 50'
        ]
      },
      {
        heading: 'Risk Factors You Can Change',
        bullets: [
          'Low calcium and vitamin D intake',
          'Lack of exercise',
          'Smoking',
          'Excessive alcohol consumption',
          'Low body weight',
          'Certain medications (long-term steroids)'
        ]
      },
      {
        heading: 'Building Strong Bones',
        subsections: [
          {
            subheading: 'Nutrition',
            bullets: [
              'Get 1,200mg calcium daily (dairy, leafy greens, fortified foods)',
              'Take 800-1,000 IU vitamin D daily',
              'Eat protein at each meal',
              'Limit caffeine and carbonated drinks'
            ]
          },
          {
            subheading: 'Exercise',
            bullets: [
              'Weight-bearing exercises (walking, dancing, tennis)',
              'Strength training 2-3 times per week',
              'Balance exercises to prevent falls',
              'Tai chi or yoga for flexibility and balance'
            ]
          },
          {
            subheading: 'Medications',
            bullets: [
              'Take osteoporosis medications exactly as prescribed',
              'Follow special instructions (some must be taken on empty stomach)',
              'Report any side effects to your doctor',
              'Don\'t stop medications without consulting your doctor'
            ]
          }
        ]
      },
      {
        heading: 'Fall Prevention',
        bullets: [
          'Remove tripping hazards at home',
          'Install grab bars in bathroom',
          'Use non-slip mats',
          'Ensure good lighting throughout home',
          'Wear supportive, non-slip shoes',
          'Have vision checked regularly',
          'Review medications that may cause dizziness'
        ]
      },
      {
        heading: 'When to Call Your Doctor',
        bullets: [
          'You have a fall, even if no obvious injury',
          'Sudden severe back pain',
          'Loss of height or stooped posture',
          'Difficulty with daily activities due to pain',
          'Side effects from osteoporosis medications'
        ]
      }
    ]
  },
  'dementia_care': {
    title: 'Dementia and Memory Care',
    sections: [
      {
        heading: 'Understanding Dementia',
        content: 'Dementia is not a single disease but a general term for a decline in mental ability severe enough to interfere with daily life. Alzheimer\'s disease is the most common type of dementia.',
        highlight: true
      },
      {
        heading: 'Common Signs and Symptoms',
        bullets: [
          'Memory loss that disrupts daily life',
          'Challenges in planning or solving problems',
          'Difficulty completing familiar tasks',
          'Confusion with time or place',
          'Trouble understanding visual images or spatial relationships',
          'Problems with words in speaking or writing',
          'Misplacing things and losing ability to retrace steps',
          'Decreased or poor judgment',
          'Withdrawal from work or social activities',
          'Changes in mood and personality'
        ]
      },
      {
        heading: 'Communication Strategies',
        subsections: [
          {
            subheading: 'Do',
            bullets: [
              'Speak slowly and clearly',
              'Use simple words and short sentences',
              'Give one instruction at a time',
              'Allow plenty of time for response',
              'Use touch and eye contact',
              'Show respect and avoid talking down'
            ]
          },
          {
            subheading: 'Don\'t',
            bullets: [
              'Argue or try to convince',
              'Ask "don\'t you remember?"',
              'Say "I just told you that"',
              'Talk about the person as if they aren\'t there',
              'Raise your voice or use a harsh tone'
            ]
          }
        ]
      },
      {
        heading: 'Daily Care Tips',
        bullets: [
          'Establish a daily routine and stick to it',
          'Keep environment calm and predictable',
          'Use memory aids (calendars, labels, photos)',
          'Simplify tasks - break into small steps',
          'Reduce clutter and distractions',
          'Ensure adequate lighting',
          'Monitor for signs of pain or discomfort',
          'Encourage independence in safe activities'
        ]
      },
      {
        heading: 'Managing Challenging Behaviors',
        subsections: [
          {
            subheading: 'Agitation or Aggression',
            bullets: [
              'Stay calm and reassuring',
              'Try to identify triggers',
              'Redirect attention to something pleasant',
              'Provide a quiet, calming environment'
            ]
          },
          {
            subheading: 'Wandering',
            bullets: [
              'Ensure doors and windows are secure',
              'Consider ID bracelet with contact information',
              'Provide safe space to walk',
              'Redirect to another activity'
            ]
          },
          {
            subheading: 'Sundowning (late-day confusion)',
            bullets: [
              'Maintain consistent schedule',
              'Limit caffeine and naps',
              'Ensure adequate lighting in evening',
              'Reduce noise and activity in evening'
            ]
          }
        ]
      },
      {
        heading: 'Caregiver Self-Care',
        important: true,
        bullets: [
          'Take breaks - you can\'t pour from an empty cup',
          'Accept help from family and friends',
          'Join a support group',
          'Maintain your own health appointments',
          'Stay physically active',
          'Get adequate sleep',
          'Seek professional help if feeling overwhelmed'
        ]
      },
      {
        heading: 'When to Call for Help',
        bullets: [
          'Significant changes in behavior or abilities',
          'Signs of depression or anxiety',
          'Difficulty managing medications',
          'Safety concerns at home',
          'Caregiver stress or burnout',
          'Physical aggression or threats',
          'Inability to meet basic needs'
        ]
      }
    ]
  },
  'anticoagulation': {
    title: 'Blood Thinner (Anticoagulation) Management',
    sections: [
      {
        heading: 'Why You\'re Taking Blood Thinners',
        content: 'Blood thinners (anticoagulants) help prevent blood clots that can cause heart attack, stroke, or other serious conditions. Common reasons include atrial fibrillation, previous blood clots, mechanical heart valves, or other heart conditions.',
        highlight: true
      },
      {
        heading: 'Common Blood Thinners',
        bullets: [
          'Warfarin (Coumadin) - requires regular INR monitoring',
          'Apixaban (Eliquis)',
          'Rivaroxaban (Xarelto)',
          'Dabigatran (Pradaxa)',
          'Edoxaban (Savaysa)',
          'Enoxaparin (Lovenox) - injection'
        ]
      },
      {
        heading: 'Taking Your Medication Safely',
        important: true,
        bullets: [
          'Take exactly as prescribed - never skip or double doses',
          'Take at the same time every day',
          'Don\'t stop taking without talking to your doctor',
          'Tell all healthcare providers you take blood thinners',
          'Carry a card or wear medical alert jewelry',
          'Keep all INR monitoring appointments (if on warfarin)',
          'Report any missed doses to your doctor'
        ]
      },
      {
        heading: 'Diet Considerations',
        subsections: [
          {
            subheading: 'If Taking Warfarin',
            bullets: [
              'Be consistent with vitamin K intake (leafy greens)',
              'Don\'t make sudden diet changes',
              'Limit alcohol to 1-2 drinks per day',
              'Avoid cranberry juice and grapefruit juice'
            ]
          },
          {
            subheading: 'If Taking Other Blood Thinners',
            bullets: [
              'No special diet restrictions',
              'Limit alcohol consumption',
              'Stay well hydrated',
              'Maintain balanced, healthy diet'
            ]
          }
        ]
      },
      {
        heading: 'Safety Precautions',
        bullets: [
          'Use electric razor instead of blade',
          'Use soft toothbrush and waxed dental floss',
          'Wear gloves when gardening or doing yard work',
          'Avoid contact sports and activities with high fall risk',
          'Be careful with sharp objects (knives, scissors)',
          'Avoid going barefoot',
          'Don\'t take aspirin or NSAIDs unless approved by doctor',
          'Check with doctor before taking any new medications or supplements'
        ]
      },
      {
        heading: 'Warning Signs of Bleeding',
        important: true,
        bullets: [
          'Unusual bruising or bleeding',
          'Nosebleeds that won\'t stop',
          'Bleeding gums',
          'Blood in urine (pink, red, or dark brown)',
          'Blood in stool (red or black, tarry stools)',
          'Vomiting blood or material that looks like coffee grounds',
          'Coughing up blood',
          'Heavier than normal menstrual bleeding',
          'Severe headache or dizziness'
        ]
      },
      {
        heading: 'CALL 911 IMMEDIATELY IF:',
        emergency: true,
        bullets: [
          'Severe headache or confusion',
          'Difficulty speaking or vision changes',
          'Weakness or numbness on one side',
          'Chest pain or pressure',
          'Severe shortness of breath',
          'Severe abdominal pain',
          'Major fall or head injury',
          'Uncontrolled bleeding'
        ]
      }
    ]
  },
  'nutrition': {
    title: 'Healthy Eating for Seniors',
    sections: [
      {
        heading: 'Why Good Nutrition Matters',
        content: 'Proper nutrition helps maintain strength, energy, immune function, and overall health. As we age, our nutritional needs change, and eating well becomes even more important for preventing disease and maintaining independence.',
        highlight: true
      },
      {
        heading: 'Essential Nutrients',
        subsections: [
          {
            subheading: 'Protein',
            bullets: [
              'Builds and maintains muscle mass',
              'Aim for protein at every meal',
              'Good sources: lean meats, fish, eggs, dairy, beans, nuts'
            ]
          },
          {
            subheading: 'Fiber',
            bullets: [
              'Promotes digestive health',
              'Aim for 25-30 grams daily',
              'Good sources: whole grains, fruits, vegetables, beans'
            ]
          },
          {
            subheading: 'Calcium and Vitamin D',
            bullets: [
              'Essential for bone health',
              '1,200mg calcium and 800-1,000 IU vitamin D daily',
              'Sources: dairy, fortified foods, fatty fish, sunshine'
            ]
          },
          {
            subheading: 'B Vitamins',
            bullets: [
              'Support energy and brain function',
              'Sources: whole grains, leafy greens, eggs, meat',
              'May need B12 supplement - ask your doctor'
            ]
          }
        ]
      },
      {
        heading: 'Building a Healthy Plate',
        bullets: [
          'Half your plate: colorful fruits and vegetables',
          'Quarter of your plate: lean protein',
          'Quarter of your plate: whole grains',
          'Include low-fat dairy or alternative',
          'Use healthy fats in moderation (olive oil, nuts, avocado)',
          'Drink water throughout the day'
        ]
      },
      {
        heading: 'Overcoming Common Challenges',
        subsections: [
          {
            subheading: 'Loss of Appetite',
            bullets: [
              'Eat smaller, more frequent meals',
              'Choose nutrient-dense foods',
              'Make meals social and enjoyable',
              'Try light exercise to stimulate appetite'
            ]
          },
          {
            subheading: 'Difficulty Chewing or Swallowing',
            bullets: [
              'Choose softer foods or modify texture',
              'Use sauces and gravies to moisten foods',
              'Cut food into small pieces',
              'Try smoothies and soups',
              'See dentist if dental issues'
            ]
          },
          {
            subheading: 'Changes in Taste',
            bullets: [
              'Use herbs and spices for flavor',
              'Vary food temperature and texture',
              'Try new foods and recipes',
              'Limit salt - use lemon, garlic, herbs instead'
            ]
          }
        ]
      },
      {
        heading: 'Meal Planning Tips',
        bullets: [
          'Keep nutritious snacks on hand',
          'Prepare meals in batches and freeze portions',
          'Make use of healthy convenience foods',
          'Consider meal delivery services if needed',
          'Shop with a list to avoid impulse purchases',
          'Read nutrition labels',
          'Stock pantry with staples'
        ]
      },
      {
        heading: 'Staying Hydrated',
        important: true,
        bullets: [
          'Drink 6-8 glasses of water daily',
          'Don\'t wait until thirsty to drink',
          'Limit caffeine and alcohol',
          'Eat water-rich foods (fruits, vegetables, soups)',
          'Keep water bottle handy',
          'Watch for signs of dehydration: dark urine, dizziness, confusion'
        ]
      }
    ]
  },
  'pneumonia': {
    title: 'Pneumonia Recovery',
    sections: [
      {
        heading: 'What is Pneumonia?',
        content: 'Pneumonia is an infection that inflames the air sacs in one or both lungs. The air sacs may fill with fluid or pus, causing cough with phlegm, fever, chills, and difficulty breathing.',
        highlight: true
      },
      {
        heading: 'Recovery at Home',
        bullets: [
          'Get plenty of rest - your body needs energy to fight infection',
          'Take all antibiotics as prescribed, even if you feel better',
          'Drink plenty of fluids (8-10 glasses of water daily)',
          'Use a humidifier to ease breathing',
          'Take fever reducers as recommended',
          'Eat nutritious meals to support healing'
        ]
      },
      {
        heading: 'Breathing Techniques',
        bullets: [
          'Use an incentive spirometer as directed',
          'Practice deep breathing exercises hourly',
          'Cough to clear mucus - support chest with pillow if painful',
          'Sit upright when possible to ease breathing',
          'Use oxygen as prescribed'
        ]
      },
      {
        heading: 'Preventing Pneumonia',
        bullets: [
          'Get pneumonia vaccine as recommended',
          'Get annual flu shot',
          'Wash hands frequently',
          'Don\'t smoke - avoid secondhand smoke',
          'Stay away from sick people when possible',
          'Keep your mouth clean - brush teeth twice daily'
        ]
      },
      {
        heading: 'Warning Signs - Call Your Doctor',
        important: true,
        bullets: [
          'Fever over 100.4°F that won\'t go down',
          'Increased shortness of breath',
          'Chest pain that worsens',
          'Coughing up blood',
          'Confusion or changes in mental awareness',
          'Blue lips or fingernails',
          'Inability to keep fluids down'
        ]
      }
    ]
  },
  'uti': {
    title: 'Urinary Tract Infection (UTI) Prevention & Care',
    sections: [
      {
        heading: 'Understanding UTIs',
        content: 'A urinary tract infection (UTI) is an infection in any part of your urinary system - kidneys, bladder, or urethra. Most infections involve the lower urinary tract (bladder and urethra).',
        highlight: true
      },
      {
        heading: 'Common Symptoms',
        bullets: [
          'Strong, persistent urge to urinate',
          'Burning sensation when urinating',
          'Passing frequent, small amounts of urine',
          'Cloudy or strong-smelling urine',
          'Pelvic pain (in women)',
          'Blood in urine (pink or red)',
          'Fever or confusion (may indicate kidney infection)'
        ]
      },
      {
        heading: 'Treatment',
        bullets: [
          'Take all antibiotics as prescribed',
          'Drink plenty of water (8-10 glasses daily)',
          'Urinate frequently - don\'t hold it',
          'Use heating pad on lower abdomen for comfort',
          'Avoid caffeine and alcohol',
          'Cranberry juice or supplements may help prevent future UTIs'
        ]
      },
      {
        heading: 'Prevention Tips',
        bullets: [
          'Drink plenty of water throughout the day',
          'Urinate after sexual activity',
          'Wipe front to back after using bathroom',
          'Avoid irritating feminine products',
          'Change incontinence products frequently',
          'Keep genital area clean and dry',
          'Wear cotton underwear',
          'Avoid tight-fitting pants'
        ]
      },
      {
        heading: 'For Catheter Users',
        bullets: [
          'Keep drainage bag below bladder level',
          'Clean around catheter site daily',
          'Empty bag before it gets full',
          'Watch for signs of infection',
          'Keep catheter secured to prevent pulling'
        ]
      },
      {
        heading: 'When to Seek Help',
        important: true,
        bullets: [
          'Symptoms don\'t improve after 2-3 days of antibiotics',
          'Fever over 101°F',
          'Severe back or side pain',
          'Nausea and vomiting',
          'Blood in urine',
          'Confusion or behavioral changes (especially in elderly)'
        ]
      }
    ]
  },
  'parkinsons': {
    title: 'Living with Parkinson\'s Disease',
    sections: [
      {
        heading: 'Understanding Parkinson\'s Disease',
        content: 'Parkinson\'s disease is a progressive nervous system disorder that affects movement. Symptoms develop gradually, often starting with a barely noticeable tremor in one hand.',
        highlight: true
      },
      {
        heading: 'Common Symptoms',
        bullets: [
          'Tremor (usually starts in hands)',
          'Slowed movement (bradykinesia)',
          'Rigid muscles',
          'Impaired posture and balance',
          'Loss of automatic movements',
          'Speech changes',
          'Writing changes (smaller handwriting)'
        ]
      },
      {
        heading: 'Medication Management',
        important: true,
        bullets: [
          'Take medications exactly on schedule',
          'Take with or without food as directed',
          'Don\'t stop medications suddenly',
          'Keep medication diary to track effectiveness',
          'Report "wearing off" effects to doctor',
          'Store medications properly'
        ]
      },
      {
        heading: 'Daily Living Strategies',
        subsections: [
          {
            subheading: 'Movement & Exercise',
            bullets: [
              'Exercise daily - walking, stretching, tai chi',
              'Physical therapy as prescribed',
              'Move slowly and deliberately',
              'Practice balance exercises',
              'Use assistive devices as needed'
            ]
          },
          {
            subheading: 'Speech & Swallowing',
            bullets: [
              'Speak slowly and clearly',
              'Face person when talking',
              'Take small bites and chew thoroughly',
              'Sit upright when eating',
              'Speech therapy if recommended'
            ]
          },
          {
            subheading: 'Home Safety',
            bullets: [
              'Remove tripping hazards',
              'Install grab bars',
              'Use non-slip mats',
              'Keep walkways well-lit',
              'Wear sturdy shoes with non-slip soles'
            ]
          }
        ]
      },
      {
        heading: 'Managing Non-Motor Symptoms',
        bullets: [
          'Depression and anxiety - talk to your doctor',
          'Sleep problems - maintain sleep schedule',
          'Constipation - increase fiber and fluids',
          'Low blood pressure - rise slowly from sitting/lying',
          'Fatigue - pace activities, rest when needed'
        ]
      },
      {
        heading: 'When to Call Your Doctor',
        bullets: [
          'New or worsening symptoms',
          'Medication side effects',
          'Falls or near-falls',
          'Difficulty swallowing',
          'Hallucinations or confusion',
          'Severe depression or anxiety'
        ]
      }
    ]
  },
  'catheter_care': {
    title: 'Urinary Catheter Care',
    sections: [
      {
        heading: 'About Your Catheter',
        content: 'A urinary catheter is a tube that drains urine from your bladder into a collection bag. Proper care is essential to prevent infection and ensure comfort.',
        highlight: true
      },
      {
        heading: 'Daily Catheter Care',
        bullets: [
          'Wash hands before and after touching catheter',
          'Clean around catheter insertion site twice daily with soap and water',
          'Rinse and pat dry gently',
          'Keep catheter secured to inner thigh (men) or abdomen (women)',
          'Avoid pulling or tugging on catheter',
          'Check for kinks in tubing'
        ]
      },
      {
        heading: 'Drainage Bag Care',
        bullets: [
          'Keep bag below bladder level at all times',
          'Empty bag when 2/3 full or every 3-4 hours',
          'Empty into toilet - don\'t let drainage spout touch toilet',
          'Clean drainage spout with alcohol wipe after emptying',
          'Use leg bag during day, larger bag at night',
          'Change bags weekly or as directed'
        ]
      },
      {
        heading: 'Preventing Infection',
        important: true,
        bullets: [
          'Drink 8-10 glasses of water daily',
          'Clean catheter site daily',
          'Never disconnect catheter from bag unnecessarily',
          'Shower instead of bath',
          'Take prescribed antibiotics if ordered',
          'Watch for signs of infection'
        ]
      },
      {
        heading: 'Lifestyle with Catheter',
        bullets: [
          'You can shower with catheter in place',
          'Secure bag to leg under clothing',
          'Wear loose-fitting clothes',
          'Stay active - walking is encouraged',
          'Empty bag before long trips or activities',
          'Carry extra supplies when going out'
        ]
      },
      {
        heading: 'Signs of Problems - Call Your Nurse',
        bullets: [
          'No urine output for 4-6 hours',
          'Urine is very cloudy or has strong odor',
          'Blood in urine (more than slight pink tinge)',
          'Fever over 100.4°F',
          'Leaking around catheter',
          'Catheter falls out',
          'Pain, redness, or swelling at insertion site',
          'Severe bladder spasms'
        ]
      }
    ]
  },
  'tube_feeding': {
    title: 'Tube Feeding Care',
    sections: [
      {
        heading: 'About Tube Feeding',
        content: 'Tube feeding (enteral nutrition) provides liquid nutrition through a tube placed in your stomach or small intestine. This ensures you get the nutrition you need when you can\'t eat enough by mouth.',
        highlight: true
      },
      {
        heading: 'Types of Feeding Tubes',
        bullets: [
          'NG tube (through nose to stomach) - short term',
          'G-tube or PEG (directly into stomach) - long term',
          'J-tube (into small intestine)',
          'Your nurse will teach you about your specific tube type'
        ]
      },
      {
        heading: 'Tube Site Care',
        bullets: [
          'Wash hands before touching tube or site',
          'Clean around tube site daily with soap and water',
          'Rotate tube gently (if instructed) to prevent sticking',
          'Check for redness, swelling, or drainage',
          'Keep site dry between cleanings',
          'Change dressing as instructed (usually 2-3 times per week)',
          'Secure tube to prevent pulling'
        ]
      },
      {
        heading: 'Giving Feedings',
        subsections: [
          {
            subheading: 'Before Feeding',
            bullets: [
              'Wash hands thoroughly',
              'Sit upright (30-45 degrees) during and after feeding',
              'Check tube placement as instructed',
              'Flush tube with water'
            ]
          },
          {
            subheading: 'During Feeding',
            bullets: [
              'Follow prescribed feeding schedule and amount',
              'Use feeding at room temperature',
              'Control feeding rate as instructed',
              'Never force feeding if resistance felt',
              'Stay upright during feeding'
            ]
          },
          {
            subheading: 'After Feeding',
            bullets: [
              'Flush tube with prescribed amount of water',
              'Cap tube securely',
              'Stay upright for 30-60 minutes',
              'Clean equipment and store properly'
            ]
          }
        ]
      },
      {
        heading: 'Preventing Problems',
        important: true,
        bullets: [
          'Flush tube with water before and after feedings',
          'Flush after giving medications',
          'Keep head elevated 30-45 degrees during and after feeding',
          'Give medications separately (crush pills if allowed)',
          'Provide good mouth care even if not eating',
          'Store formula properly (refrigerate after opening)',
          'Discard unused formula after 24 hours'
        ]
      },
      {
        heading: 'When to Call Your Nurse',
        bullets: [
          'Tube comes out or is pulled out',
          'Tube appears blocked - won\'t flush',
          'Increased redness, swelling, or drainage at site',
          'Fever over 100.4°F',
          'Nausea or vomiting',
          'Severe abdominal pain or bloating',
          'Diarrhea (more than 3 loose stools per day)',
          'Difficulty breathing during feeding'
        ]
      }
    ]
  },
  'hospice_comfort': {
    title: 'Hospice & Comfort Care',
    sections: [
      {
        heading: 'Understanding Hospice Care',
        content: 'Hospice care focuses on comfort and quality of life when curative treatment is no longer the goal. It provides physical, emotional, and spiritual support for patients and families.',
        highlight: true
      },
      {
        heading: 'Goals of Hospice Care',
        bullets: [
          'Manage pain and other symptoms',
          'Provide comfort and dignity',
          'Support emotional and spiritual needs',
          'Help family members cope',
          'Allow patient to remain at home if desired',
          'Provide 24/7 support'
        ]
      },
      {
        heading: 'Managing Common Symptoms',
        subsections: [
          {
            subheading: 'Pain',
            bullets: [
              'Give pain medications on schedule, not waiting for pain',
              'Report uncontrolled pain immediately',
              'Use comfort measures (positioning, massage)',
              'Keep environment calm and quiet'
            ]
          },
          {
            subheading: 'Breathing',
            bullets: [
              'Elevate head of bed',
              'Use fan for air circulation',
              'Keep room temperature comfortable',
              'Use oxygen as prescribed',
              'Provide reassuring presence'
            ]
          },
          {
            subheading: 'Mouth Care',
            bullets: [
              'Keep mouth moist with swabs or ice chips',
              'Apply lip balm frequently',
              'Provide mouth care every 2-4 hours',
              'Don\'t force food or fluids'
            ]
          }
        ]
      },
      {
        heading: 'Providing Comfort',
        bullets: [
          'Keep patient clean and dry',
          'Turn and reposition every 2 hours',
          'Use soft pillows for support',
          'Play soothing music if desired',
          'Read to patient or talk about happy memories',
          'Hold hands, gentle touch',
          'Respect patient\'s wishes for visitors',
          'Maintain dignity and privacy'
        ]
      },
      {
        heading: 'When Death is Near',
        bullets: [
          'Breathing changes are normal',
          'Decreased need for food and water',
          'Increased sleeping',
          'Restlessness or confusion may occur',
          'Cool hands and feet are common',
          'Hearing remains - speak to your loved one',
          'Your presence brings comfort'
        ]
      },
      {
        heading: 'Caregiver Self-Care',
        important: true,
        bullets: [
          'Accept help from others',
          'Take breaks when you can',
          'Eat regular meals and rest',
          'Talk about your feelings',
          'Call hospice team anytime - day or night',
          'Remember: you are not alone'
        ]
      },
      {
        heading: 'When to Call Hospice Team',
        bullets: [
          'Uncontrolled pain or symptoms',
          'Anxiety or restlessness',
          'Questions about medications',
          'Need for supplies',
          'You need support or have concerns',
          'Changes in patient\'s condition',
          'When death occurs'
        ]
      }
    ]
  },
  'copd_oxygen': {
    title: 'Home Oxygen Therapy for COPD',
    sections: [
      {
        heading: 'Why You Need Oxygen',
        content: 'Supplemental oxygen helps ensure your body gets the oxygen it needs when your lungs can\'t provide enough on their own. Proper oxygen use can improve your energy, reduce shortness of breath, and protect your heart and other organs.',
        highlight: true
      },
      {
        heading: 'Understanding Your Prescription',
        bullets: [
          'Your doctor prescribes specific oxygen flow rate (liters per minute)',
          'Follow your prescription exactly - don\'t adjust on your own',
          'You may have different rates for rest, activity, and sleep',
          'Keep your prescription information with your equipment',
          'Oxygen is a medication - treat it as such'
        ]
      },
      {
        heading: 'Types of Oxygen Equipment',
        subsections: [
          {
            subheading: 'Oxygen Concentrator',
            bullets: [
              'Runs on electricity',
              'Takes oxygen from room air',
              'Most common for home use',
              'Keep backup portable system'
            ]
          },
          {
            subheading: 'Portable Oxygen Concentrator (POC)',
            bullets: [
              'Battery powered for mobility',
              'Lighter weight for travel',
              'Allows more independence'
            ]
          },
          {
            subheading: 'Oxygen Tanks',
            bullets: [
              'Compressed gas in cylinders',
              'Portable options available',
              'Good for backup/emergencies'
            ]
          }
        ]
      },
      {
        heading: 'Using Your Oxygen Safely',
        important: true,
        bullets: [
          'NO SMOKING - you, visitors, or anyone in the home',
          'Keep oxygen away from open flames, candles, gas stoves',
          'Stay at least 5-10 feet from heat sources',
          'Don\'t use aerosol products near oxygen',
          'Keep oxygen equipment away from oils and greases',
          'Post "No Smoking - Oxygen in Use" signs',
          'Know where fire extinguisher is located',
          'Have working smoke detectors'
        ]
      },
      {
        heading: 'Daily Oxygen Use',
        bullets: [
          'Use oxygen as prescribed - typically 15+ hours daily',
          'Wear during sleep if prescribed',
          'Use during activities and exercise',
          'Check tubing daily for kinks or damage',
          'Clean nasal cannula weekly with mild soap and water',
          'Keep extra supplies on hand (tubing, cannulas)',
          'Arrange equipment to prevent tripping',
          'Keep oxygen supplier\'s phone number handy'
        ]
      },
      {
        heading: 'Traveling with Oxygen',
        bullets: [
          'Contact oxygen supplier 2 weeks before travel',
          'Airlines require advance notice for oxygen',
          'Bring extra supplies and batteries',
          'Keep prescription information with you',
          'Know location of oxygen suppliers at destination',
          'Plan for power outages with backup system'
        ]
      },
      {
        heading: 'Troubleshooting',
        subsections: [
          {
            subheading: 'Equipment Not Working',
            bullets: [
              'Check power source and connections',
              'Ensure tubing not kinked',
              'Switch to backup system if available',
              'Contact supplier for emergencies'
            ]
          },
          {
            subheading: 'Still Short of Breath',
            bullets: [
              'Verify oxygen is flowing',
              'Check flow rate matches prescription',
              'Try pursed-lip breathing',
              'Rest and use oxygen continuously',
              'Call doctor if not improving'
            ]
          }
        ]
      },
      {
        heading: 'When to Call Your Doctor',
        bullets: [
          'Increased shortness of breath despite oxygen',
          'Needing higher flow rates than prescribed',
          'Chest pain or irregular heartbeat',
          'Confusion or extreme drowsiness',
          'Headaches, especially in morning',
          'Bluish color to lips or fingernails',
          'Swelling in ankles or legs'
        ]
      }
    ]
  }
};

Deno.serve(async (req) => {
  let doc;
  let base44, user;
  const diagnostics = {
    stage: 'initialization',
    timestamp: new Date().toISOString(),
    condition: null,
    sectionsProcessed: 0,
    totalSections: 0,
    failedSection: null,
    userAgent: req.headers.get('user-agent'),
    contentLength: 0
  };
  
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    diagnostics.userId = user.email;
    diagnostics.stage = 'parsing_request';

    const body = await req.json();
    console.log('Request body:', body);
    
    const { condition, patientName, patientEmail, action, selectedSections, customNotes, styleOptions } = body;
    diagnostics.condition = condition;
    diagnostics.action = action;
    
    // Parse style options with defaults
    const style = {
      colorScheme: styleOptions?.colorScheme || 'penn_health',
      fontFamily: styleOptions?.fontFamily || 'helvetica',
      layout: styleOptions?.layout || 'standard',
      customHeader: styleOptions?.customHeader || '',
      customFooter: styleOptions?.customFooter || '',
      agencyName: styleOptions?.agencyName || 'Penn Home Health Inc.',
      agencyPhone: styleOptions?.agencyPhone || '724-465-0440'
    };
    
    if (!condition) {
      return Response.json({ error: 'Condition is required' }, { status: 400 });
    }
    
    if (!handoutTemplates[condition]) {
      return Response.json({ error: `Invalid condition: ${condition}` }, { status: 400 });
    }

    const template = handoutTemplates[condition];
    diagnostics.totalSections = template.sections?.length || 0;
    console.log('Using template:', condition);
    console.log('Template has', diagnostics.totalSections, 'sections');
    
    diagnostics.stage = 'creating_pdf_instance';
    // Create PDF with accessibility metadata
    console.log('Creating jsPDF instance...');
    doc = new jsPDF();
    console.log('jsPDF instance created successfully');
    diagnostics.stage = 'pdf_metadata';
    
    // Set PDF metadata for accessibility
    doc.setProperties({
      title: template.title,
      subject: 'Patient Education Material',
      author: 'Penn Home Health Inc.',
      keywords: 'patient education, healthcare, ' + condition,
      creator: 'Penn Home Health Documentation System',
      language: 'en-US'
    });
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Layout-specific settings
    const layoutConfig = {
      standard: { margin: 25, lineSpacing: 6, titleSize: 24, headingSize: 15, bodySize: 11 },
      compact: { margin: 15, lineSpacing: 5, titleSize: 20, headingSize: 13, bodySize: 10 },
      large_print: { margin: 20, lineSpacing: 8, titleSize: 28, headingSize: 18, bodySize: 14 },
      two_column: { margin: 20, lineSpacing: 6, titleSize: 22, headingSize: 14, bodySize: 11 }
    };
    
    const config = layoutConfig[style.layout] || layoutConfig.standard;
    const margin = config.margin;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = margin;
    
    // Color scheme mapping
    const colorSchemes = {
      penn_health: {
        primary: [41, 98, 255],
        primaryLight: [232, 239, 255],
        accent: [0, 150, 136],
        text: [33, 33, 33],
        textLight: [100, 100, 100]
      },
      professional_blue: {
        primary: [21, 101, 192],
        primaryLight: [227, 242, 253],
        accent: [2, 119, 189],
        text: [38, 50, 56],
        textLight: [96, 125, 139]
      },
      warm_care: {
        primary: [216, 67, 21],
        primaryLight: [255, 243, 224],
        accent: [245, 124, 0],
        text: [62, 39, 35],
        textLight: [121, 85, 72]
      },
      serene_green: {
        primary: [46, 125, 50],
        primaryLight: [232, 245, 233],
        accent: [56, 142, 60],
        text: [27, 94, 32],
        textLight: [76, 175, 80]
      },
      elegant_purple: {
        primary: [106, 27, 154],
        primaryLight: [243, 229, 245],
        accent: [123, 31, 162],
        text: [74, 20, 140],
        textLight: [142, 36, 170]
      }
    };
    
    const COLORS = {
      ...colorSchemes[style.colorScheme],
      emergency: [220, 38, 38],
      important: [245, 158, 11],
      success: [16, 185, 129],
      divider: [229, 229, 229]
    };
    
    // Accessibility: Use consistent, readable font sizes (minimum 12pt for body text)
    const FONT_SIZE_TITLE = config.titleSize;
    const FONT_SIZE_HEADING = config.headingSize;
    const FONT_SIZE_SUBHEADING = config.headingSize - 2;
    const FONT_SIZE_BODY = config.bodySize;
    const FONT_SIZE_SMALL = config.bodySize - 2;
    const LINE_SPACING = config.lineSpacing;
    
    // Set font family based on style options
    const fontFamily = style.fontFamily === 'times' ? 'times' : 
                       style.fontFamily === 'courier' ? 'courier' : 'helvetica';

    // Header with logo and branding
    try {
      const logoResponse = await fetch(LOGO_URL);
      const logoBlob = await logoResponse.blob();
      const logoArrayBuffer = await logoBlob.arrayBuffer();
      const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      // Professional header background
      doc.setFillColor(232, 239, 255);
      doc.rect(0, 0, pageWidth, 45, 'F');
      
      // Add logo
      const logoWidth = 45;
      const logoHeight = 17;
      doc.addImage(logoDataUrl, 'PNG', margin, yPos + 2, logoWidth, logoHeight);
      
      // Header text next to logo
      doc.setFontSize(FONT_SIZE_SMALL);
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
      doc.text(style.agencyPhone, pageWidth - margin, yPos + 8, { align: 'right' });
      doc.text('www.pennhh.com', pageWidth - margin, yPos + 14, { align: 'right' });

      // Custom header text if provided
      if (style.customHeader) {
        doc.setFontSize(FONT_SIZE_SMALL - 1);
        doc.setFont(fontFamily, 'italic');
        doc.text(style.customHeader, pageWidth / 2, yPos + 22, { align: 'center' });
      }
      
      yPos += 35;
    } catch (error) {
      console.log('Logo loading skipped:', error.message);
      yPos += 15;
    }

    // Title with professional styling
    yPos += 10;
    doc.setFontSize(FONT_SIZE_TITLE);
    doc.setFont(fontFamily, 'bold');
    doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
    doc.text(template.title, pageWidth / 2, yPos, { align: 'center' });
    
    // Decorative underline
    const titleWidth = doc.getTextWidth(template.title);
    doc.setLineWidth(2);
    doc.setDrawColor(COLORS.accent[0], COLORS.accent[1], COLORS.accent[2]);
    doc.line((pageWidth - titleWidth) / 2, yPos + 3, (pageWidth + titleWidth) / 2, yPos + 3);
    
    yPos += 15;

    // Patient info card
    if (patientName) {
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(229, 229, 229);
      doc.setLineWidth(0.5);
      doc.rect(margin, yPos, contentWidth, 18, 'FD');
      
      doc.setFontSize(FONT_SIZE_BODY);
      doc.setFont(fontFamily, 'bold');
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
      doc.text('Prepared for:', margin + 5, yPos + 7);
      doc.setFont(fontFamily, 'normal');
      doc.text(patientName, margin + 5, yPos + 13);
      
      doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
      doc.setFontSize(FONT_SIZE_SMALL);
      doc.text(`Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, pageWidth - margin - 5, yPos + 10, { align: 'right' });
      
      yPos += 25;
    } else {
      doc.setFontSize(FONT_SIZE_SMALL);
      doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
      doc.text(`Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, pageWidth - margin, yPos, { align: 'right' });
      yPos += 12;
    }
    
    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);

    // Filter sections based on selection - with safety checks
    let sectionsToInclude = template.sections || [];
    if (selectedSections && typeof selectedSections === 'object') {
      sectionsToInclude = sectionsToInclude.filter(section => {
        // If section heading is not in selectedSections, include it by default
        if (!selectedSections[section.heading]) return true;
        // Otherwise check if it's explicitly included
        return selectedSections[section.heading]?.included !== false;
      });
    }

    console.log(`Processing ${sectionsToInclude.length} sections for ${condition}`);
    diagnostics.stage = 'rendering_sections';

    // Content sections - Accessibility: Structured, readable body text
    doc.setFontSize(FONT_SIZE_BODY);
    
    // Add try-catch around section rendering to isolate errors
    for (let sectionIdx = 0; sectionIdx < sectionsToInclude.length; sectionIdx++) {
      const section = sectionsToInclude[sectionIdx];
      diagnostics.currentSection = section.heading;
      diagnostics.sectionsProcessed = sectionIdx;
      
      try {
      // Check if we need a new page
      if (yPos > pageHeight - 40) {
        doc.addPage();
        yPos = margin;
      }

      // Section heading with professional styling
      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(FONT_SIZE_HEADING);
      
      // Color-coded section indicator
      let sectionColor = COLORS.primary;
      if (section.emergency) {
        sectionColor = COLORS.emergency;
      } else if (section.important) {
        sectionColor = COLORS.important;
      }
      
      // Side accent bar
      doc.setFillColor(sectionColor[0], sectionColor[1], sectionColor[2]);
      doc.rect(margin, yPos - 4, 3, FONT_SIZE_HEADING, 'F');
      
      doc.setTextColor(sectionColor[0], sectionColor[1], sectionColor[2]);
      // Sanitize heading - keep only ASCII printable characters
      const sanitizedHeading = String(section.heading || 'Section')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x00-\x7F]/g, '');
      doc.text(sanitizedHeading, margin + 8, yPos);
      
      // Subtle divider line
      doc.setDrawColor(COLORS.divider[0], COLORS.divider[1], COLORS.divider[2]);
      doc.setLineWidth(0.3);
      doc.line(margin, yPos + 3, pageWidth - margin, yPos + 3);
      
      yPos += 10;
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);

      // Section content - Accessibility: Readable font size, proper line spacing
      doc.setFont(fontFamily, 'normal');
      doc.setFontSize(FONT_SIZE_BODY);
      
      if (section.content && typeof section.content === 'string') {
        // Professional highlight box
        if (section.highlight) {
          doc.setFillColor(232, 239, 255);
          doc.setDrawColor(41, 98, 255);
          doc.setLineWidth(0.5);
          // Sanitize content - keep only ASCII printable characters
          const sanitizedContent = section.content
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x00-\x7F]/g, '');
          const lines = doc.splitTextToSize(sanitizedContent, contentWidth - 20);
          const boxHeight = lines.length * LINE_SPACING + 12;
          doc.rect(margin, yPos - 3, contentWidth, boxHeight, 'FD');

          doc.setFont(fontFamily, 'normal');
          lines.forEach(line => {
            if (yPos > pageHeight - 30) {
              doc.addPage();
              yPos = margin + 20;
            }
            doc.text(line, margin + 10, yPos);
            yPos += LINE_SPACING;
          });
          yPos += 9;
        } else {
          // Sanitize content - keep only ASCII printable characters
          const sanitizedContent = section.content
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x00-\x7F]/g, '');
          const lines = doc.splitTextToSize(sanitizedContent, contentWidth - 5);
          lines.forEach(line => {
            if (yPos > pageHeight - 30) {
              doc.addPage();
              yPos = margin + 20;
            }
            doc.text(line, margin + 3, yPos);
            yPos += LINE_SPACING;
          });
          yPos += 5;
        }
      }

      // Handle subsections with safety check
      if (section.subsections && Array.isArray(section.subsections)) {
        for (const subsection of section.subsections) {
          try {
          if (yPos > pageHeight - 30) {
            doc.addPage();
            yPos = margin;
          }
          
          // Subsection heading with professional styling
          doc.setFont(fontFamily, 'bold');
          doc.setFontSize(FONT_SIZE_SUBHEADING);
          doc.setTextColor(COLORS.accent[0], COLORS.accent[1], COLORS.accent[2]);

          const sanitizedSubheading = String(subsection.subheading || 'Subsection')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x00-\x7F]/g, '');
          doc.text(`  ${sanitizedSubheading}`, margin + 5, yPos);
          yPos += 8;
          doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(FONT_SIZE_BODY);
          
          // Subsection bullets with error handling
          if (subsection.bullets && Array.isArray(subsection.bullets)) {
            for (const bullet of subsection.bullets) {
              try {
              if (yPos > pageHeight - 20) {
                doc.addPage();
                yPos = margin;
              }
              // Sanitize bullet text - keep only ASCII printable characters
              const sanitizedBullet = String(bullet || '')
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\x00-\x7F]/g, '');
              const bulletLines = doc.splitTextToSize('  • ' + sanitizedBullet, contentWidth - 25);
              bulletLines.forEach((line) => {
                doc.text(line, margin + 18, yPos);
                yPos += LINE_SPACING;
              });
              } catch (bulletError) {
                console.error('Error rendering subsection bullet:', bulletError);
                yPos += 6; // Skip this bullet and continue
              }
            }
          }
          yPos += 3;
          } catch (subsectionError) {
            console.error(`Error rendering subsection "${subsection.subheading}":`, subsectionError);
            yPos += 8; // Skip this subsection
          }
        }
      }

      // Regular bullets with error handling
      if (section.bullets && Array.isArray(section.bullets)) {
        // Filter bullets based on selection
        let bulletsToInclude = section.bullets;
        if (selectedSections?.[section.heading]?.bullets) {
          bulletsToInclude = section.bullets.filter((bullet, idx) => 
            selectedSections[section.heading].bullets[idx] !== false
          );
        }
        
        for (const bullet of bulletsToInclude) {
          try {
          if (yPos > pageHeight - 20) {
            doc.addPage();
            yPos = margin;
          }
          // Sanitize bullet text - keep only ASCII printable characters
          const sanitizedBullet = String(bullet || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x00-\x7F]/g, '');
          const bulletLines = doc.splitTextToSize('• ' + sanitizedBullet, contentWidth - 15);
          bulletLines.forEach((line) => {
            doc.text(line, margin + 5, yPos);
            yPos += LINE_SPACING;
          });
          } catch (bulletError) {
            console.error('Error rendering bullet:', bulletError);
            yPos += 6; // Skip and continue
          }
        }
        yPos += 3;
      }
      
      yPos += 5;
      } catch (sectionError) {
        diagnostics.failedSection = section.heading;
        diagnostics.sectionError = sectionError.message;
        console.error(`Error rendering section "${section.heading}":`, sectionError);
        // Continue with next section instead of failing entire PDF
        doc.setFontSize(FONT_SIZE_BODY);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(200, 0, 0);
        doc.text(`[Error rendering section: ${section.heading}]`, margin + 5, yPos);
        yPos += 10;
        doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
      }
    }
    
    diagnostics.stage = 'sections_complete';
    diagnostics.sectionsProcessed = sectionsToInclude.length;

    // Custom notes section with error handling
    if (customNotes && typeof customNotes === 'string' && customNotes.trim()) {
      try {
      if (yPos > pageHeight - 60) {
        doc.addPage();
        yPos = margin;
      }
      
      yPos += 10;
      
      // Professional custom notes section
      doc.setFillColor(255, 251, 235); // Warm yellow background
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(1);
      // Sanitize custom notes
      const sanitizedNotes = customNotes.replace(/[^\x20-\x7E\xA0-\xFF\n\r]/g, '');
      const notesLines = doc.splitTextToSize(sanitizedNotes, contentWidth - 20);
      const notesHeight = notesLines.length * LINE_SPACING + 20;
      doc.rect(margin, yPos - 3, contentWidth, notesHeight, 'FD');

      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(FONT_SIZE_SUBHEADING);
      doc.setTextColor(COLORS.important[0], COLORS.important[1], COLORS.important[2]);
      doc.text('Special Instructions from Your Nurse', margin + 8, yPos + 5);

      yPos += 12;
      doc.setFont(fontFamily, 'normal');
      doc.setFontSize(FONT_SIZE_BODY);
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
      notesLines.forEach(line => {
        if (yPos > pageHeight - 30) {
          doc.addPage();
          yPos = margin + 20;
        }
        doc.text(line, margin + 8, yPos);
        yPos += LINE_SPACING;
      });
      yPos += 12;
      } catch (notesError) {
        console.error('Error rendering custom notes:', notesError);
        // Continue without custom notes
      }
      }

      // Add interactive tracking checklist if available
      const checklist = trackingChecklists[condition];
      if (checklist && checklist.length > 0) {
      try {
        if (yPos > pageHeight - 100) {
          doc.addPage();
          yPos = margin;
        }

        yPos += 10;

        // Checklist header
        doc.setFillColor(COLORS.primaryLight[0], COLORS.primaryLight[1], COLORS.primaryLight[2]);
        doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
        doc.setLineWidth(1);
        doc.rect(margin, yPos - 3, contentWidth, 15, 'FD');

        doc.setFont(fontFamily, 'bold');
        doc.setFontSize(FONT_SIZE_SUBHEADING);
        doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
        doc.text('Daily Self-Care Checklist', margin + 8, yPos + 5);

        yPos += 18;

        // Checklist items with checkboxes
        doc.setFont(fontFamily, 'normal');
        doc.setFontSize(FONT_SIZE_BODY);
        doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);

        checklist.forEach((item, idx) => {
          if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = margin + 20;
          }

          // Draw checkbox
          const checkboxSize = 5;
          doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
          doc.setLineWidth(0.5);
          doc.rect(margin + 5, yPos - checkboxSize + 1, checkboxSize, checkboxSize);

          // Add item text - sanitize checklist items
          const sanitizedItem = String(item)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x00-\x7F]/g, '');
          const itemLines = doc.splitTextToSize(sanitizedItem, contentWidth - 20);
          itemLines.forEach((line, lineIdx) => {
            doc.text(line, margin + 13, yPos + (lineIdx * LINE_SPACING));
          });

          yPos += Math.max(LINE_SPACING * itemLines.length, 8);
        });

        yPos += 5;

        // Instructions
        doc.setFont(fontFamily, 'italic');
        doc.setFontSize(FONT_SIZE_SMALL);
        doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
        doc.text('Check off each item as you complete it daily', margin + 5, yPos);
        yPos += 10;
      } catch (checklistError) {
        console.error('Error rendering checklist:', checklistError);
      }
      }

      // Add symptom tracking section
      try {
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = margin;
      }

      yPos += 10;

      // Tracking section header
      doc.setFillColor(COLORS.primaryLight[0], COLORS.primaryLight[1], COLORS.primaryLight[2]);
      doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
      doc.setLineWidth(1);
      doc.rect(margin, yPos - 3, contentWidth, 15, 'FD');

      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(FONT_SIZE_SUBHEADING);
      doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
      doc.text('Daily Symptom Tracker', margin + 8, yPos + 5);

      yPos += 20;

      // Create tracking table
      doc.setFont(fontFamily, 'normal');
      doc.setFontSize(FONT_SIZE_SMALL);
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);

      const tableHeaders = ['Date', 'Symptoms', 'Notes'];
      const colWidth = contentWidth / 3;
      const rowHeight = 12;

      // Draw header row
      doc.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
      doc.rect(margin, yPos, contentWidth, rowHeight, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont(fontFamily, 'bold');
      tableHeaders.forEach((header, idx) => {
        doc.text(header, margin + 3 + (idx * colWidth), yPos + 7);
      });

      yPos += rowHeight;

      // Draw empty rows for tracking
      doc.setDrawColor(COLORS.divider[0], COLORS.divider[1], COLORS.divider[2]);
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
      doc.setFont(fontFamily, 'normal');

      for (let i = 0; i < 7; i++) {
        // Draw row borders
        doc.rect(margin, yPos, contentWidth, rowHeight);
        // Draw column separators
        doc.line(margin + colWidth, yPos, margin + colWidth, yPos + rowHeight);
        doc.line(margin + (colWidth * 2), yPos, margin + (colWidth * 2), yPos + rowHeight);

        yPos += rowHeight;
      }

      yPos += 5;

      // Instructions
      doc.setFont(fontFamily, 'italic');
      doc.setFontSize(FONT_SIZE_SMALL);
      doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
      doc.text('Record your daily symptoms and bring this log to your appointments', margin + 5, yPos);
      yPos += 10;
      } catch (trackingError) {
      console.error('Error rendering tracking section:', trackingError);
      }

      // Add helpful resources with clickable links
      const resources = interactiveResources[condition];
      if (resources && resources.length > 0) {
      try {
        if (yPos > pageHeight - 60) {
          doc.addPage();
          yPos = margin;
        }

        yPos += 10;

        // Resources header
        doc.setFillColor(COLORS.primaryLight[0], COLORS.primaryLight[1], COLORS.primaryLight[2]);
        doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
        doc.setLineWidth(1);
        doc.rect(margin, yPos - 3, contentWidth, 15, 'FD');

        doc.setFont(fontFamily, 'bold');
        doc.setFontSize(FONT_SIZE_SUBHEADING);
        doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
        doc.text('Helpful Online Resources', margin + 8, yPos + 5);

        yPos += 20;

        // Add clickable resource links
        doc.setFont(fontFamily, 'normal');
        doc.setFontSize(FONT_SIZE_BODY);

        resources.forEach((resource, idx) => {
          if (yPos > pageHeight - 30) {
            doc.addPage();
            yPos = margin + 20;
          }

          // Bullet point
          doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
          doc.text('•', margin + 5, yPos);

          // Resource text (clickable) - sanitize text
          const sanitizedResourceText = String(resource.text)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x00-\x7F]/g, '');
          doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
          doc.textWithLink(sanitizedResourceText, margin + 10, yPos, { url: resource.url });

          // Add underline to indicate link
          const textWidth = doc.getTextWidth(resource.text);
          doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
          doc.setLineWidth(0.3);
          doc.line(margin + 10, yPos + 1, margin + 10 + textWidth, yPos + 1);

          yPos += LINE_SPACING + 2;
        });

        yPos += 5;

        // Instructions
        doc.setFont(fontFamily, 'italic');
        doc.setFontSize(FONT_SIZE_SMALL);
        doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
        doc.text('Click on the blue links above to visit these helpful websites', margin + 5, yPos);
        yPos += 10;
      } catch (resourcesError) {
        console.error('Error rendering resources:', resourcesError);
      }
      }

      // Professional footer
    const footerY = pageHeight - 25;
    
    // Footer background
    doc.setFillColor(248, 248, 248);
    doc.rect(0, footerY - 5, pageWidth, 30, 'F');
    
    // Footer divider line
    doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
    doc.setLineWidth(1);
    doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
    
    // Footer content
    doc.setFontSize(FONT_SIZE_SMALL);
    doc.setFont(fontFamily, 'bold');
    doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
    doc.text(style.agencyName, pageWidth / 2, footerY + 2, { align: 'center' });

    doc.setFont(fontFamily, 'normal');
    doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
    doc.text(`Phone: ${style.agencyPhone}  |  www.pennhh.com`, pageWidth / 2, footerY + 7, { align: 'center' });

    // Custom footer if provided
    if (style.customFooter) {
      doc.setFontSize(FONT_SIZE_SMALL - 1);
      const footerLines = doc.splitTextToSize(style.customFooter, contentWidth);
      let footerYPos = footerY + 11;
      footerLines.forEach(line => {
        doc.text(line, pageWidth / 2, footerYPos, { align: 'center' });
        footerYPos += 4;
      });
    } else {
      doc.setFontSize(FONT_SIZE_SMALL - 1);
      doc.setTextColor(COLORS.textLight[0], COLORS.textLight[1], COLORS.textLight[2]);
      doc.text('This information is for educational purposes only. Always follow your healthcare provider\'s advice.', pageWidth / 2, footerY + 12, { align: 'center' });
    }

    // Generate PDF with error handling
    diagnostics.stage = 'generating_pdf_output';
    console.log('Generating PDF output...');
    let pdfBytes, base64Pdf;
    try {
      pdfBytes = doc.output('arraybuffer');
      diagnostics.pdfSize = pdfBytes.byteLength;
      
      // Convert to base64 in chunks to avoid stack overflow
      const uint8Array = new Uint8Array(pdfBytes);
      const chunkSize = 8192;
      let binary = '';
      
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      
      diagnostics.stage = 'encoding_base64';
      base64Pdf = btoa(binary);
      diagnostics.contentLength = base64Pdf.length;
      console.log('PDF generated successfully, length:', base64Pdf.length);
      diagnostics.stage = 'complete';
    } catch (pdfError) {
      diagnostics.stage = 'pdf_output_error';
      diagnostics.pdfError = pdfError.message;
      console.error('Error generating PDF binary:', pdfError);
      throw new Error(`PDF generation failed: ${pdfError.message}`);
    }

    // If action is email, send it with PDF attachment
    if (action === 'email' && patientEmail) {
      console.log('Sending email to:', patientEmail);
      diagnostics.stage = 'sending_email';
      
      try {
        // Create a data URL for the PDF to include in email
        const pdfDataUrl = `data:application/pdf;base64,${base64Pdf}`;
        
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'Penn Home Health',
          to: patientEmail,
          subject: `Patient Education: ${template.title}`,
          body: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">Penn Home Health Inc.</h1>
              </div>
              
              <div style="padding: 30px; background: #f9f9f9;">
                <p>Dear ${patientName || 'Patient'},</p>
                
                <p>Please find attached educational information about <strong>${template.title}</strong>.</p>
                
                <p>This handout has been prepared specifically for you by your Penn Home Health care team. Please review this information carefully.</p>
                
                <p><strong>What to do:</strong></p>
                <ul>
                  <li>Read through the entire handout</li>
                  <li>Keep it in a safe place for future reference</li>
                  <li>Contact your nurse if you have any questions</li>
                  <li>Share with family members who help with your care</li>
                </ul>
                
                <p>If you have any questions or concerns, please don't hesitate to contact us at <strong>724-465-0440</strong>.</p>
                
                <p>Best regards,<br>
                <strong>Penn Home Health Team</strong></p>
              </div>
              
              <div style="background: #667eea; padding: 15px; text-align: center; color: white; font-size: 12px;">
                <p style="margin: 0;">Penn Home Health Inc. | 724-465-0440 | www.pennhh.com</p>
              </div>
            </div>
          `
        });
        console.log('Email sent successfully');
        diagnostics.stage = 'email_complete';
      } catch (emailError) {
        diagnostics.emailError = emailError.message;
        console.error('Email send error:', emailError);
        
        // Log email error to system
        try {
          await base44.asServiceRole.entities.SystemLog.create({
            job_name: 'PDF Email Error',
            job_type: 'other',
            status: 'error',
            message: `Failed to email ${diagnostics.condition} handout to ${patientEmail}`,
            details: { ...diagnostics, emailError: emailError.message }
          });
        } catch (logErr) {
          console.error('Failed to log email error:', logErr);
        }
        
        throw new Error(`Failed to send email: ${emailError.message}`);
      }

      return Response.json({ 
        success: true, 
        message: `Handout emailed to ${patientEmail}` 
      });
    }

    // Return PDF as base64 for download
    console.log('Returning PDF response');
    console.log('Response diagnostics:', {
      stage: diagnostics.stage,
      pdfLength: base64Pdf?.length,
      filename: `${condition}_handout.pdf`
    });
    
    return Response.json({
      success: true,
      pdf: base64Pdf,
      filename: `${condition}_handout.pdf`,
      diagnostics: {
        stage: diagnostics.stage,
        sectionsProcessed: diagnostics.sectionsProcessed,
        totalSections: diagnostics.totalSections
      }
    });

  } catch (error) {
    diagnostics.errorStage = diagnostics.stage;
    diagnostics.errorMessage = error.message;
    diagnostics.errorStack = error.stack;
    diagnostics.errorName = error.name;
    
    console.error('Error generating handout:', error);
    console.error('Diagnostics:', JSON.stringify(diagnostics, null, 2));
    
    // Log error to SystemLog and send admin email notification
    try {
      if (base44) {
        const errorLog = await base44.asServiceRole.entities.SystemLog.create({
          job_name: 'PDF Generation Error',
          job_type: 'other',
          status: 'error',
          message: `Failed to generate ${diagnostics.condition || 'unknown'} handout at stage: ${diagnostics.stage}`,
          details: {
            ...diagnostics,
            timestamp: new Date().toISOString(),
            userEmail: user?.email || 'unknown',
            browser: diagnostics.userAgent,
            errorDetails: {
              message: error.message,
              name: error.name,
              stack: error.stack?.substring(0, 500) // Limit stack trace length
            }
          },
          error_stack: error.stack
        });
        console.log('Error logged to SystemLog');
        
        // Send admin email notification
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            from_name: 'Penn Sync System',
            to: 'admin@pennhomehealth.com',
            subject: `🚨 PDF Generation Error - ${diagnostics.condition || 'Unknown Handout'}`,
            body: `
              <h2>PDF Generation Error Report</h2>
              <p><strong>Timestamp:</strong> ${diagnostics.timestamp}</p>
              <p><strong>User:</strong> ${user?.email || 'unknown'}</p>
              <p><strong>Condition:</strong> ${diagnostics.condition || 'unknown'}</p>
              <p><strong>Failed Stage:</strong> ${diagnostics.stage}</p>
              <p><strong>Failed Section:</strong> ${diagnostics.failedSection || 'N/A'}</p>
              
              <h3>Error Details:</h3>
              <p><strong>Error Name:</strong> ${error.name}</p>
              <p><strong>Error Message:</strong> ${error.message}</p>
              
              <h3>Diagnostic Information:</h3>
              <pre>${JSON.stringify(diagnostics, null, 2)}</pre>
              
              <h3>Stack Trace:</h3>
              <pre>${error.stack?.substring(0, 1000)}</pre>
              
              <p><a href="https://app.base44.com/app/pennsync">View in Penn Sync Admin</a></p>
            `
          });
          console.log('Admin notification email sent');
        } catch (emailError) {
          console.error('Failed to send admin notification email:', emailError);
        }
      }
    } catch (logError) {
      console.error('Failed to log error to SystemLog:', logError);
    }
    
    // Try to generate a minimal fallback PDF
    try {
      console.log('Attempting fallback PDF generation...');
      if (!doc) {
        doc = new jsPDF();
      }
      
      // Create a simple error PDF
      const fallbackDoc = new jsPDF();
      fallbackDoc.setFontSize(16);
      fallbackDoc.setFont('helvetica', 'bold');
      fallbackDoc.text('Penn Home Health Inc.', 105, 30, { align: 'center' });
      
      fallbackDoc.setFontSize(14);
      fallbackDoc.setFont('helvetica', 'normal');
      fallbackDoc.text('Patient Education Handout', 105, 45, { align: 'center' });
      
      fallbackDoc.setFontSize(12);
      fallbackDoc.text('We apologize, but there was an issue generating', 105, 70, { align: 'center' });
      fallbackDoc.text('the full handout. Please contact your nurse for', 105, 80, { align: 'center' });
      fallbackDoc.text('this information.', 105, 90, { align: 'center' });
      
      fallbackDoc.setFontSize(10);
      fallbackDoc.text(`Topic: ${error.condition || 'Unknown'}`, 20, 110);
      fallbackDoc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 120);
      fallbackDoc.text('Phone: 724-465-0440', 20, 140);
      
      const fallbackBytes = fallbackDoc.output('arraybuffer');
      const fallbackArray = new Uint8Array(fallbackBytes);
      const chunkSize = 8192;
      let fallbackBinary = '';
      
      for (let i = 0; i < fallbackArray.length; i += chunkSize) {
        const chunk = fallbackArray.subarray(i, Math.min(i + chunkSize, fallbackArray.length));
        fallbackBinary += String.fromCharCode.apply(null, chunk);
      }
      
      const fallbackBase64 = btoa(fallbackBinary);
      console.log('Fallback PDF generated');
      
      return Response.json({
        success: true,
        pdf: fallbackBase64,
        filename: 'error_fallback.pdf',
        warning: 'Generated fallback PDF due to error: ' + error.message
      });
    } catch (fallbackError) {
      console.error('Fallback PDF generation also failed:', fallbackError);
    }
    
    return Response.json({ 
      error: error.message || 'Unknown error occurred',
      details: `Error at stage: ${diagnostics.stage}. ${diagnostics.failedSection ? `Failed section: ${diagnostics.failedSection}` : ''}`,
      stage: diagnostics.stage,
      diagnostics: diagnostics,
      type: error.name
    }, { status: 500 });
  }
});