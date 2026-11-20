// Industry Intelligence Library.
// Each industry carries (a) research notes shown in the UI and fed to the AI as
// context, and (b) spoken-language building blocks that the zero-cost template
// engine assembles into the 6-part voicemail structure:
//   intro → observation → missed-call scenario → competitor/loss → solution → CTA
// Add a new industry by appending an object here; nothing else needs to change.
//
// Placeholders: {first_name} {business_name} {city} {area} {sender} {company}
// Revenue language is deliberately hedged ("could", "might", "potentially").

export const INDUSTRIES = [
  {
    key: 'barbershop',
    label: 'Barbershops & Salons',
    keywords: ['barber', 'barbershop', 'salon', 'hair', 'stylist', 'beauty', 'nail', 'lash', 'brow', 'spa', 'fade', 'cuts'],
    painPoint: 'Hands are busy with a client all day, so the phone rings out between cuts and color appointments.',
    missedCall: 'A new client trying to book goes to voicemail, and most people do not leave one.',
    competitorReason: 'There is another shop a few blocks away on Google Maps with an open slot today.',
    revenueImpact: 'Each missed first-time client can also mean every rebooking that would have followed.',
    vocabulary: ['fades', 'cuts', 'chairs', 'walk-ins', 'appointments', 'beard trims', 'rebooking', 'color', 'blowouts'],
    howWeSolve: 'The AI receptionist answers while you are cutting, books into open slots, and the text-back catches anyone who hangs up so they book with you instead of the next shop.',
    observations: [
      "when you're in the middle of a fade or working with a client",
      "when every chair is full on a Saturday",
    ],
    callers: [
      'your phone might be ringing with someone trying to book a cut',
      'somebody new could be calling to see if you can fit them in today',
    ],
    competitor: [
      "If nobody answers, there's a good chance they're calling the next barber on Google",
      "If it rings out, most people won't leave a voicemail. They'll just try the next shop on the map",
    ],
    loss: [
      "That's potentially a new client lost before you even get a chance to talk to them, plus every rebooking that could've come after",
      "That's a chair that could've been filled, and maybe a regular you never got to meet",
    ],
    solution: {
      voice: "I've got a simple way to answer those calls for you, even mid-cut, and get people booked into your open slots",
      text: "I've got a simple way to automatically text those callers back the second you miss them, so they book with you instead of moving on",
      both: "I've got a simple way to automatically catch those calls, answer questions, and turn them into bookings, even when you're behind the chair",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a quick voicemail. When you're mid-cut and the phone rings, those callers usually book somewhere else. We set up a simple way to catch them and get them booked with {business_name}. Want to see a 1-minute example? Reply STOP to opt out.",
  },
  {
    key: 'restaurant',
    label: 'Restaurants & Bars',
    keywords: ['restaurant', 'bar', 'grill', 'cafe', 'café', 'pizza', 'pizzeria', 'kitchen', 'bistro', 'taco', 'sushi', 'diner', 'pub', 'tavern', 'bbq', 'catering', 'eatery', 'brewery'],
    painPoint: 'Phones ring hardest during the dinner rush, exactly when staff are busiest serving tables.',
    missedCall: 'Reservation, takeout, and catering calls go unanswered or sit on hold.',
    competitorReason: 'Hungry customers decide in minutes; they just call or order from the next place.',
    revenueImpact: 'A missed catering or large-party call can be worth far more than a single table.',
    vocabulary: ['dinner rush', 'reservations', 'takeout', 'delivery', 'tables', 'catering', 'busy shifts', 'large parties', 'hours'],
    howWeSolve: 'A virtual host answers every call, handles hours/menu/reservation questions, books tables, and texts back anyone who hangs up so the order stays with you.',
    observations: [
      'during your dinner rush, when your staff is busy serving customers',
      'on a packed Friday night when everyone on the floor is slammed',
    ],
    callers: [
      'how many people might be calling to book a table or ask about takeout',
      'someone could be calling about a large party or a catering order',
    ],
    competitor: [
      "If nobody answers, they might just call another restaurant",
      "If the phone just rings, they're probably already ordering from the place down the street",
    ],
    loss: [
      "One of those could be a catering order or a party of twelve, not just one table",
      "That's potentially a whole table, or a regular, that never made it through the door",
    ],
    solution: {
      voice: "Imagine having a virtual host answer those calls, handle questions, and help customers book a table, even when your team is slammed",
      text: "Imagine every missed caller instantly getting a friendly text with your menu or reservation link, so they still order from you",
      both: "Imagine having a virtual receptionist answer those calls, handle questions, and text back anyone who hangs up, even when your team is slammed",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a voicemail. During the dinner rush, calls about tables, takeout, and catering can slip through. We help {business_name} catch those calls so they don't go to the next restaurant. Want a quick example? Reply STOP to opt out.",
  },
  {
    key: 'roofing',
    label: 'Roofing Companies',
    keywords: ['roof', 'roofing', 'roofer', 'gutter', 'shingle', 'storm', 'exteriors'],
    painPoint: 'Owners and crews are on roofs or at inspections all day, and call volume spikes right after storms.',
    missedCall: 'A homeowner with storm damage or a leak calls for an inspection and gets voicemail.',
    competitorReason: 'After a storm, homeowners call several roofers and book whoever answers first.',
    revenueImpact: 'A single roofing job or insurance claim can be a significant ticket, so one missed call matters.',
    vocabulary: ['storm damage', 'inspections', 'estimates', 'insurance claims', 'roofing jobs', 'leaks', 'replacements', 'crews', 'adjusters'],
    howWeSolve: 'Calls get answered instantly, the AI gathers address and damage details, books the inspection, and missed callers get a text before they dial the next roofer.',
    observations: [
      "when a homeowner calls you after a storm looking for an inspection or an estimate",
      "right after a big hailstorm, when every homeowner in {area} is calling around",
    ],
    callers: [
      "what happens if you're up on another job and can't answer",
      "and you're on a roof or meeting an adjuster and can't pick up",
    ],
    competitor: [
      "They may call the next roofer they find on Google",
      "Most of them just book whoever answers first",
    ],
    loss: [
      "One missed call could mean losing a valuable roofing job",
      "That could be a full replacement or an insurance job going to someone else",
    ],
    solution: {
      voice: "We've built a system that answers those calls instantly, gets the details, and helps get inspections booked",
      text: "We've built a system that instantly texts back every missed caller so they wait for you instead of calling around",
      both: "We've built a system that catches those calls, responds instantly, and helps get inspections booked",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a quick voicemail. When homeowners call about storm damage and you're on a job, they usually call the next roofer. We help {business_name} catch those calls and get inspections booked. Open to a quick example? Reply STOP to opt out.",
  },
  {
    key: 'hvac',
    label: 'HVAC Companies',
    keywords: ['hvac', 'heating', 'cooling', 'air conditioning', 'a/c', 'ac repair', 'furnace', 'heat pump', 'mechanical', 'refrigeration', 'air'],
    painPoint: 'Technicians are in attics and on service calls; emergency calls arrive after hours and on the hottest/coldest days.',
    missedCall: 'A homeowner with no AC or no heat reaches voicemail during peak season.',
    competitorReason: 'An emergency caller will not wait; they call the next company that can come out today.',
    revenueImpact: 'Emergency repairs often lead to maintenance plans and system replacements down the road.',
    vocabulary: ['AC breakdown', 'emergency service calls', 'technicians', 'service appointments', 'repair jobs', 'maintenance plans', 'tune-ups', 'no heat'],
    howWeSolve: 'The AI receptionist answers 24/7, triages emergencies, books service appointments, and texts back anyone who hangs up so they stay with you.',
    observations: [
      "imagine someone's AC goes out in the middle of a hot {city_or_texas} afternoon",
      "picture someone's heat going out on the coldest night of the year",
    ],
    callers: [
      "They call your company, but your technicians are busy and nobody picks up",
      "They call you first, but it's after hours and it goes to voicemail",
    ],
    competitor: [
      "Do you think that homeowner waits, or calls the next HVAC company",
      "Honestly, most people in that spot just call the next company that answers",
    ],
    loss: [
      "That's a repair job, and maybe a long-term maintenance customer, gone",
      "That's not just one service call. It could be the system replacement down the road",
    ],
    solution: {
      voice: "That's exactly the kind of missed opportunity we help prevent with an AI receptionist that answers and books service calls around the clock",
      text: "That's exactly the kind of missed opportunity we help prevent with an automatic text-back that reaches them within seconds",
      both: "That's exactly the kind of missed opportunity we're helping businesses prevent with an AI receptionist and automatic text-back system",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a voicemail. When an AC goes out and your techs can't pick up, that homeowner usually calls the next company. We help {business_name} answer and book those calls 24/7. Want to see a quick example? Reply STOP to opt out.",
  },
  {
    key: 'plumbing',
    label: 'Plumbing Businesses',
    keywords: ['plumb', 'plumber', 'plumbing', 'drain', 'sewer', 'water heater', 'rooter', 'pipe', 'leak'],
    painPoint: 'Plumbers are under sinks and in crawl spaces; urgent calls come in at all hours.',
    missedCall: 'A burst pipe or backed-up drain call goes to voicemail.',
    competitorReason: 'Water on the floor means the customer calls down the list until someone answers.',
    revenueImpact: 'Emergency calls are often high-value and can turn into repeat customers.',
    vocabulary: ['burst pipes', 'clogged drains', 'water heaters', 'emergency calls', 'service calls', 'leaks', 'sewer lines', 'dispatch'],
    howWeSolve: 'Calls are answered instantly, the AI captures the problem and address, books or flags emergencies, and missed callers get an immediate text.',
    observations: [
      "when you're under a sink or in a crawl space on a job",
      "think about someone with water all over their kitchen floor",
    ],
    callers: [
      "and a homeowner with a burst pipe calls your shop",
      "They call your number, and nobody can grab the phone",
    ],
    competitor: [
      "They're not waiting for a callback. They're calling the next plumber on the list",
      "Most people in that situation just keep calling until someone picks up",
    ],
    loss: [
      "That's an emergency job, and maybe a customer for life, going to someone else",
      "That could be a water heater install or a big repair you never even heard about",
    ],
    solution: {
      voice: "We set up an AI receptionist that answers those calls, gets the details, and books the job while you're working",
      text: "We set up an automatic text-back so every missed caller hears from you in seconds and knows help is coming",
      both: "We set up a simple system that answers those calls, texts back anyone who hangs up, and gets the job on your schedule",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just sent you a quick voicemail. When you're on a job and someone calls with a leak, they usually call the next plumber. We help {business_name} catch those calls automatically. Want a quick example? Reply STOP to opt out.",
  },
  {
    key: 'landscaping',
    label: 'Landscaping & Lawn Care',
    keywords: ['landscap', 'lawn', 'mowing', 'yard', 'tree', 'irrigation', 'sprinkler', 'garden', 'hardscape', 'sod', 'turf'],
    painPoint: 'Crews are out with loud equipment all day; spring brings a flood of estimate requests.',
    missedCall: 'A homeowner looking for weekly service or a project quote cannot get through.',
    competitorReason: 'Homeowners usually get two or three quotes and go with whoever responds first.',
    revenueImpact: 'A recurring weekly lawn customer or a hardscape project can be worth a lot over a season.',
    vocabulary: ['estimates', 'weekly mowing', 'crews', 'spring cleanups', 'hardscaping', 'irrigation', 'recurring routes', 'the season'],
    howWeSolve: 'The AI receptionist takes estimate requests and books walkthroughs while crews work; missed callers get a text so they wait for your quote.',
    observations: [
      "when you and your crews are out running mowers all day",
      "in the spring, when everybody in {area} suddenly wants their yard done",
    ],
    callers: [
      "a homeowner might be calling for a quote on weekly service",
      "someone could be calling about a big cleanup or hardscape project",
    ],
    competitor: [
      "If you can't hear the phone, they just call the next lawn company",
      "Most homeowners go with whoever gets back to them first",
    ],
    loss: [
      "That could be a customer you'd have kept on your route all season",
      "That's potentially a whole season of recurring work going somewhere else",
    ],
    solution: {
      voice: "We set up an AI receptionist that answers those calls and books estimates while you're out on the job",
      text: "We set up an automatic text-back so missed callers hear from you right away and wait for your quote",
      both: "We set up a simple system that answers those calls, texts back anyone you miss, and gets estimates on your calendar",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a voicemail. When your crews are out, quote requests can slip to the next lawn company. We help {business_name} catch those calls automatically. Want to see a quick example? Reply STOP to opt out.",
  },
  {
    key: 'dental',
    label: 'Dental Practices',
    keywords: ['dental', 'dentist', 'dds', 'dmd', 'orthodont', 'smile', 'teeth', 'implant', 'endodont', 'periodont'],
    painPoint: 'Front desk juggles check-ins, insurance, and patients in the chair while the phone keeps ringing.',
    missedCall: 'New patients and emergency toothache calls hit voicemail or hold during busy hours and lunch.',
    competitorReason: 'New patients usually call the next in-network office instead of leaving a message.',
    revenueImpact: 'A new patient can mean years of cleanings and treatment plans for the practice.',
    vocabulary: ['new patients', 'front desk', 'cleanings', 'hygiene schedule', 'emergency appointments', 'insurance questions', 'treatment plans', 'recall'],
    howWeSolve: 'The AI receptionist answers overflow and after-hours calls, handles common insurance and hours questions, books new patients, and texts back missed callers.',
    observations: [
      "when your front desk is checking in patients and handling insurance at the same time",
      "during lunch or after hours, when nobody's at the front desk",
    ],
    callers: [
      "a new patient might be calling to book their first cleaning",
      "someone with a toothache could be trying to get in today",
    ],
    competitor: [
      "If they hit voicemail, a lot of people just call the next dentist on their insurance list",
      "New patients rarely leave a message. They just try the next office",
    ],
    loss: [
      "That's potentially years of cleanings and treatment from one patient",
      "That's a new patient who might never know how good your practice is",
    ],
    solution: {
      voice: "We set up an AI receptionist that picks up those overflow and after-hours calls, answers common questions, and books new patients",
      text: "We set up an automatic text-back so anyone your team misses gets a friendly message right away and books with you",
      both: "We set up a simple system that answers overflow calls, texts back anyone who hangs up, and helps get new patients on the schedule",
    },
    sms: "Hi {first_name}, it's {sender} with {company}. I just left a short voicemail. When the front desk is busy, new-patient calls can slip to the next office. We help practices like {business_name} catch those calls automatically. Open to a quick example? Reply STOP to opt out.",
  },
  {
    key: 'medical',
    label: 'Medical & Physiotherapy Clinics',
    keywords: ['clinic', 'medical', 'physio', 'physical therapy', 'chiropract', 'chiro', 'pt ', 'rehab', 'wellness', 'med spa', 'medspa', 'urgent care', 'doctor', 'health', 'therapy', 'massage'],
    painPoint: 'Staff are with patients and the phone queue backs up, especially Monday mornings.',
    missedCall: 'Prospective patients wanting an evaluation or appointment cannot get through.',
    competitorReason: 'Patients in pain book with whichever clinic can see them soonest.',
    revenueImpact: 'A new patient often means a full plan of care, not a single visit.',
    vocabulary: ['new patients', 'evaluations', 'appointments', 'plan of care', 'front desk', 'referrals', 'insurance', 'scheduling'],
    howWeSolve: 'The AI receptionist answers non-clinical calls, books evaluations, handles hours/insurance FAQs, and texts back missed callers (no medical advice given).',
    observations: [
      "when your team is with patients and the front desk phone keeps ringing",
      "on a Monday morning when the phones back up",
    ],
    callers: [
      "someone in pain might be calling to book an evaluation",
      "a new patient could be calling with a quick insurance question before they book",
    ],
    competitor: [
      "If they can't get through, they usually book with whichever clinic picks up",
      "Most people won't wait for a callback. They'll try the next clinic",
    ],
    loss: [
      "That's potentially a full plan of care, not just one visit",
      "That's a patient you could've helped who ended up somewhere else",
    ],
    solution: {
      voice: "We set up an AI receptionist that answers those scheduling calls and books evaluations while your team stays focused on patients",
      text: "We set up an automatic text-back so missed callers hear from you right away with a link to book",
      both: "We set up a simple system that answers scheduling calls, texts back anyone you miss, and helps fill your appointment book",
    },
    sms: "Hi {first_name}, it's {sender} with {company}. Just left you a short voicemail. When your team is with patients, new-patient calls can go to the next clinic. We help {business_name} catch those calls and book evaluations. Want a quick example? Reply STOP to opt out.",
  },
  {
    key: 'real_estate',
    label: 'Real Estate Agents',
    keywords: ['real estate', 'realtor', 'realty', 'broker', 'homes', 'properties', 'property', 'keller williams', 'remax', 're/max', 'coldwell', 'century 21', 'exp realty', 'compass'],
    painPoint: 'Agents are at showings and closings; sign calls and portal leads arrive when they cannot pick up.',
    missedCall: 'A buyer calling from a yard sign or listing reaches voicemail.',
    competitorReason: 'Buyers call the next agent or the listing site and get connected to someone else.',
    revenueImpact: 'One missed buyer or seller lead can be an entire commission.',
    vocabulary: ['showings', 'listings', 'yard signs', 'open houses', 'buyers', 'sellers', 'closings', 'leads', 'commission'],
    howWeSolve: 'The AI assistant answers listing and sign calls, qualifies buyers, books showings, and texts back missed callers before another agent gets them.',
    observations: [
      "when you're in the middle of a showing or at a closing",
      "when someone drives by one of your yard signs on a Saturday",
    ],
    callers: [
      "and a buyer calls about one of your listings",
      "and they call the number on the sign right then",
    ],
    competitor: [
      "If they get voicemail, they'll usually just call another agent",
      "Most buyers move on to the next agent who picks up",
    ],
    loss: [
      "One missed call like that could be a whole commission",
      "That could be a buyer, and their next three referrals, going to someone else",
    ],
    solution: {
      voice: "We set up an AI assistant that answers those calls, asks a few qualifying questions, and books showings for you",
      text: "We set up an instant text-back so every buyer who calls hears from you in seconds, even mid-showing",
      both: "We set up a simple system that answers those calls, texts back anyone you miss, and books showings while you're busy",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a quick voicemail. When you're at a showing, sign calls and listing calls can go to the next agent. We help agents catch those leads automatically. Want to see a quick example? Reply STOP to opt out.",
  },
  {
    key: 'auto_repair',
    label: 'Auto Repair Shops',
    keywords: ['auto', 'automotive', 'mechanic', 'car repair', 'tire', 'brake', 'transmission', 'collision', 'body shop', 'oil change', 'garage', 'motors', 'muffler'],
    painPoint: 'Techs are in the bays and service writers are at the counter; calls for quotes pile up.',
    missedCall: 'A driver with a check-engine light or a breakdown cannot reach the shop.',
    competitorReason: 'Drivers call the next shop that can look at the car today.',
    revenueImpact: 'A repair customer who trusts you comes back for years of maintenance.',
    vocabulary: ['bays', 'service writers', 'check engine light', 'brakes', 'oil changes', 'estimates', 'diagnostics', 'tows', 'the counter'],
    howWeSolve: 'The AI receptionist answers while the team is in the bays, books drop-offs, answers hours/services questions, and texts back missed callers.',
    observations: [
      "when your techs are in the bays and your service writer's stuck at the counter",
      "on a busy Monday morning when everybody's car problems from the weekend show up",
    ],
    callers: [
      "someone with a check-engine light might be calling to get it looked at",
      "a driver could be calling for a quote on brakes",
    ],
    competitor: [
      "If nobody picks up, they'll just call the next shop that can see the car today",
      "Most people don't leave a message. They just try the next shop on Google",
    ],
    loss: [
      "That's a repair job, and potentially years of maintenance, going down the street",
      "That's a car that could've been in your bay this afternoon",
    ],
    solution: {
      voice: "We set up an AI receptionist that answers those calls and books drop-offs while your team keeps working",
      text: "We set up an automatic text-back so every caller you miss hears from you right away",
      both: "We set up a simple system that answers those calls, texts back anyone who hangs up, and gets cars on your schedule",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a voicemail. When the bays are full, calls for quotes can go to the next shop. We help {business_name} catch those calls automatically. Want to see a quick example? Reply STOP to opt out.",
  },
  {
    key: 'home_improvement',
    label: 'Home Improvement Contractors',
    keywords: ['contractor', 'construction', 'remodel', 'renovation', 'kitchen', 'bath', 'cabinet', 'flooring', 'painting', 'painter', 'handyman', 'builder', 'fence', 'deck', 'siding', 'windows', 'doors', 'drywall', 'concrete', 'electric', 'electrician', 'pool'],
    painPoint: 'Owners are on job sites with tools running; estimate requests come in while they cannot talk.',
    missedCall: 'A homeowner ready to start a remodel or repair reaches voicemail.',
    competitorReason: 'Homeowners collect multiple bids and favor whoever responds quickly and professionally.',
    revenueImpact: 'A single remodel or project can be a large ticket, plus referrals.',
    vocabulary: ['estimates', 'bids', 'job sites', 'remodels', 'projects', 'walkthroughs', 'punch lists', 'referrals'],
    howWeSolve: 'The AI receptionist answers on the job site, captures project details, books walkthroughs, and texts back missed callers so you are first to respond.',
    observations: [
      "when you're on a job site with saws running and can't grab the phone",
      "when you're in the middle of a project and estimate calls keep coming in",
    ],
    callers: [
      "a homeowner might be calling to get a bid on their kitchen",
      "someone could be ready to start a project and calling around for estimates",
    ],
    competitor: [
      "If it goes to voicemail, they're likely calling the next contractor on their list",
      "Homeowners usually go with whoever gets back to them first",
    ],
    loss: [
      "That could be a big project, plus the referrals that come with it",
      "That's potentially your next job going to someone who just answered faster",
    ],
    solution: {
      voice: "We set up an AI receptionist that answers those calls, gets the project details, and books walkthroughs for you",
      text: "We set up an instant text-back so homeowners hear from you right away and wait for your bid",
      both: "We set up a simple system that answers those calls, texts back anyone you miss, and gets walkthroughs on your calendar",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. Just left you a quick voicemail. When you're on a job site, estimate calls can go to the next contractor. We help {business_name} catch those calls automatically. Open to a quick example? Reply STOP to opt out.",
  },
  {
    key: 'other',
    label: 'Other Local Service Businesses',
    keywords: [],
    painPoint: 'The owner and staff are busy serving customers and cannot always pick up.',
    missedCall: 'A potential customer calls, gets voicemail, and hangs up without leaving a message.',
    competitorReason: 'Most callers just try the next business on Google.',
    revenueImpact: 'Each unanswered call is potentially a new customer who never gets to hear from you.',
    vocabulary: ['customers', 'appointments', 'calls', 'quotes', 'bookings', 'busy days'],
    howWeSolve: 'The AI receptionist answers 24/7, answers common questions, books appointments, and the text-back catches anyone who hangs up.',
    observations: [
      "when you and your team are busy taking care of customers",
      "on your busiest days when the phone just keeps ringing",
    ],
    callers: [
      "a new customer might be calling to ask a question or book",
      "someone could be calling ready to buy, and nobody can pick up",
    ],
    competitor: [
      "If nobody answers, most people just call the next business on Google",
      "Most callers won't leave a voicemail. They just move on",
    ],
    loss: [
      "That's potentially a new customer lost before you even got to talk to them",
      "That's a customer who might never know what you could've done for them",
    ],
    solution: {
      voice: "We set up an AI receptionist that answers those calls, handles common questions, and books appointments for you",
      text: "We set up an automatic text-back so anyone you miss hears from you within seconds",
      both: "I've got a simple way to automatically catch those calls and turn them into customers, even when you're busy",
    },
    sms: "Hey {first_name}, it's {sender} with {company}. I just sent you a quick voice message about something that could be costing {business_name} potential customers. We help businesses catch missed calls automatically so callers don't move on to competitors. Would you be open to seeing a quick example? Reply STOP to opt out.",
  },
];

export const INDUSTRY_MAP = Object.fromEntries(INDUSTRIES.map((i) => [i.key, i]));

// Cheap, deterministic industry detection from existing CRM data (no AI call).
export function detectIndustry(contact) {
  const hay = [
    contact.business_name, contact.website, contact.email,
    ...(Array.isArray(contact.tags) ? contact.tags : []),
    ...Object.values(contact.custom_fields || {}).filter((v) => typeof v === 'string'),
  ].join(' ').toLowerCase();
  let best = { key: 'other', score: 0 };
  for (const ind of INDUSTRIES) {
    let score = 0;
    for (const kw of ind.keywords) if (hay.includes(kw)) score += kw.length > 4 ? 2 : 1;
    // An explicit tag or field that equals the industry key/label wins
    if (hay.includes(ind.key.replace('_', ' ')) || hay.includes(ind.label.toLowerCase())) score += 5;
    if (score > best.score) best = { key: ind.key, score };
  }
  return best.key;
}
