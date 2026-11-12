// Places we cover. Each gets its own page. Copy stays factual: no distances, prices or claims we cannot back up.
const NYC = 'New York City';
const R = {
  brooklyn: { group: 'Brooklyn and Manhattan', p: (n) => [`Most of our Brooklyn and Manhattan work is groups with several pickup points in one neighborhood, then a single run out of the city. List each pickup with its time and we price the whole route as one trip.`, `Typical trips from ${n}: camp runs, Shabbatons, Kehila trips, trips to the Kivrei Tzadikim, yeshiva and school outings, and weddings.`] },
  upstate: { group: 'Rockland, Orange and the Catskills', p: (n) => [`We run buses to and from ${n} for camps, Shabbatons, Kehila trips, school outings and simchas. Tell us the pickups, the destination and the return plan, and the quote lists every stop.`, `Summer traffic and camp schedules fill up early, so send the date as soon as you have it.`] },
  nj: { group: 'New Jersey', p: (n) => [`We quote buses for groups in ${n} for camp trips, Shabbatons, Kehila trips, yeshiva trips, weddings and simchas. Send the pickups, the destination and the headcount.`, `Groups with pickups in several New Jersey towns can be quoted as one route.`] },
  far: { group: 'Out of state', p: (n) => [`We also arrange charter buses for groups in ${n}. These are longer trips, so the quote lists the route, the stops and the return, and our team prices each one by hand.`, `Call or send the request form with your dates and we will tell you what we can do.`] },
};
const mk = (slug, name, region, intro, sameAs) => ({ slug, name, region, intro });
export const AREAS = [
  mk('boro-park', 'Boro Park', 'brooklyn', 'Charter buses for groups in Boro Park, Brooklyn.'),
  mk('williamsburg', 'Williamsburg', 'brooklyn', 'Charter buses for groups in Williamsburg, Brooklyn.'),
  mk('flatbush', 'Flatbush', 'brooklyn', 'Charter buses for groups in Flatbush, Brooklyn.'),
  mk('manhattan', 'Manhattan', 'brooklyn', 'Charter buses, party buses and trolleys for groups in Manhattan.'),
  mk('monsey', 'Monsey', 'upstate', 'Charter buses for groups in Monsey, New York.'),
  mk('monroe', 'Monroe', 'upstate', 'Charter buses for groups in Monroe, New York.'),
  mk('new-square', 'New Square', 'upstate', 'Charter buses for groups in New Square, New York.'),
  mk('catskills', 'the Catskills', 'upstate', 'Charter buses for camps and groups going to and from the Catskills.'),
  mk('lakewood', 'Lakewood', 'nj', 'Charter buses for groups in Lakewood, New Jersey.'),
  mk('linden', 'Linden', 'nj', 'Charter buses for groups in Linden, New Jersey.'),
  mk('jackson', 'Jackson', 'nj', 'Charter buses for groups in Jackson, New Jersey.'),
  mk('toms-river', 'Toms River', 'nj', 'Charter buses for groups in Toms River, New Jersey.'),
  mk('jersey-city', 'Jersey City', 'nj', 'Charter buses for groups in Jersey City, New Jersey.'),
  mk('cleveland', 'Cleveland', 'far', 'Charter buses for groups in Cleveland, Ohio.'),
  mk('chicago', 'Chicago', 'far', 'Charter buses for groups in Chicago, Illinois.'),
  mk('indiana', 'Indiana', 'far', 'Charter buses for groups in Indiana.'),
  mk('michigan', 'Michigan', 'far', 'Charter buses for groups in Michigan.'),
].map((a) => ({
  ...a, group: R[a.region].group,
  title: `Charter Bus Rental in ${a.name}`, h1: `Charter buses in ${a.name}`, desc: `${a.intro} Camp trips, Shabbatons, Kehila trips, Kivrei Tzadikim, school trips and simchas. Request a quote from Get A Bus NY.`,
  lead: a.intro,
  sections: [{ h: `Bus service in ${a.name}`, p: R[a.region].p(a.name) }, { h: 'How to book', p: ['Send the request form with your date, times, pickups and stops, or call the office. We reply with a price. Pricing is set by our team for each trip.'] }],
  faq: [
    { q: `Do you serve ${a.name}?`, a: `Yes. ${a.name} is one of the places we cover. Send your dates and pickups and we will quote the trip.` },
    { q: 'Can the trip start in one place and end in another?', a: 'Yes. List every pickup and drop-off and the quote shows each one.' },
  ],
}));
export const AREA_GROUPS = ['Brooklyn and Manhattan', 'Rockland, Orange and the Catskills', 'New Jersey', 'Out of state'];
