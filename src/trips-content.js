// Landing page copy for each kind of trip. Plain and factual: no invented prices, awards or statistics.
export const TRIPS = [
  {
    slug: 'camp-trips', name: 'Camp trips', title: 'Camp Trip Bus Charters', h1: 'Buses for camp trips',
    desc: 'Charter buses for camp opening day, visiting day, color war outings and end of summer trips. Many pickups, one quote, one contact.',
    lead: 'Camp days run on a fixed schedule and a long list of pickup points. We plan the route with you and quote every stop.',
    sections: [
      { h: 'What we handle', p: ['Opening day and closing day runs, visiting day shuttles, trips out of camp and rides home all work the same way. You give us the pickup points, the camp address and the headcount. We line up the vehicle and the operator.', 'Every pickup, extra stop and drop-off is listed on the quote, so the hours are not a surprise afterward.'] },
      { h: 'Which vehicle', p: ['Groups of up to 56 usually travel on a coach. Smaller groups can use a party bus or trolley for local outings. The fleet page shows the seat count for each vehicle.'] },
    ],
    faq: [
      { q: 'Can you pick up from several neighborhoods?', a: 'Yes. List each pickup with its time and we price the route as one trip.' },
      { q: 'How early should we book?', a: 'As early as you know the date. Busy days fill up, and we can only check availability once you send the details.' },
      { q: 'Who do we call on the day?', a: 'You call our office. The driver also gets the full itinerary and your contact details for the day.' },
    ],
  },
  {
    slug: 'shabbatons', name: 'Shabbatons', title: 'Shabbaton Bus Charters', h1: 'Buses for Shabbatons',
    desc: 'Charter buses for Shabbatons and Shabbos away. We check your trip against candle lighting and havdalah before we quote it.',
    lead: 'Friday departures have a hard deadline. We work backwards from candle lighting, and we plan the return for after Shabbos is out.',
    sections: [
      { h: 'Timing comes first', p: ['When you request a quote, we check the departure and return times against candle lighting and havdalah for the date. If a time falls on Shabbos or Yom Tov, we will tell you before anything is booked.', 'We also flag trips that leave close to candle lighting, so there is margin for traffic.'] },
      { h: 'Typical setup', p: ['Most Shabbaton groups go out on Friday and come back on Motzei Shabbos or Sunday. The route and the waiting time at the destination are written into the quote.'] },
    ],
    faq: [
      { q: 'Do you drive on Shabbos?', a: 'We do not schedule trips that run during Shabbos or Yom Tov. Our office is also closed on Shabbos.' },
      { q: 'What if our Friday departure runs late?', a: 'Tell us how much time you need to spare and we will plan the pickup earlier. Call the office if anything changes.' },
      { q: 'Can the bus wait for us over Shabbos?', a: 'Tell us the plan when you request the quote and we will confirm it with the operator.' },
    ],
  },
  {
    slug: 'kehila-trips', name: 'Kehila trips', title: 'Kehila and Community Trip Buses', h1: 'Buses for Kehila trips',
    desc: 'Charter buses for shul and community outings with pickups at the shul and along the way.',
    lead: 'Shul and community trips usually start at one place and pick up more people on the way. We put the whole route on one quote.',
    sections: [
      { h: 'How it works', p: ['Send the starting point, each pickup, the destination and the return plan. We quote the trip with every stop listed and tell you which vehicle fits the group.'] },
      { h: 'For organizers', p: ['One person on our side handles the quote, the deposit and the day of the trip. You can send the quote link to your committee so everyone sees the same numbers.'] },
    ],
    faq: [
      { q: 'Can we split the cost among members?', a: 'We quote and invoice one organizer. Splitting the cost among members is up to your group.' },
      { q: 'Can we change the headcount later?', a: 'Yes. Call or email and we will update the quote and record what changed.' },
    ],
  },
  {
    slug: 'kivrei-tzadikim', name: 'Kivrei Tzadikim', title: 'Kivrei Tzadikim Trip Buses', h1: 'Buses for Kivrei Tzadikim trips',
    desc: 'Charter buses for day trips and overnights to the Kivrei Tzadikim, with stops and waiting time written into the quote.',
    lead: 'These trips have several stops and long waits at each one, with time for tefillah. We plan the hours honestly so the quote matches the day.',
    sections: [
      { h: 'Stops and waiting time', p: ['List each stop and how long the group will stay. We include the waiting time in the quote and give the driver the full list.', 'The trip is checked against Shabbos and Yom Tov times for the date.'] },
      { h: 'Long drives', p: ['For long routes we use the vehicle type that suits the distance. A coach with outlets and Wi-Fi suits a full day on the road.'] },
    ],
    faq: [
      { q: 'Do you charge for the time the bus waits?', a: 'Waiting time is part of the trip and is listed on the quote. Pricing is set by our team for each trip.' },
      { q: 'Can we add a stop on the day?', a: 'Tell the driver and call the office. Extra stops are added to the invoice at the rate on your quote.' },
    ],
  },
  {
    slug: 'yeshiva-and-school-trips', name: 'Yeshiva and school trips', title: 'Yeshiva and School Trip Buses', h1: 'Buses for yeshiva and school trips',
    desc: 'Charter buses for class trips, Chol Hamoed outings and sports games, with one contact for the whole group.',
    lead: 'Class trips, Chol Hamoed outings and games need a clear schedule and one person to call. That is what we offer.',
    sections: [
      { h: 'One contact', p: ['The school office or the rebbe sends the details once. We handle the vehicle, the operator and the driver briefing.'] },
      { h: 'Group size', p: ['For a single class a trolley or party bus can work. For a full grade or several classes, a coach seats up to 56.'] },
    ],
    faq: [
      { q: 'Can the school get an invoice?', a: 'Yes. We invoice the school or the organizer and accept payment online.' },
      { q: 'Can we book a whole season of trips?', a: 'Send us the dates and we will quote them together or one at a time, as you prefer.' },
    ],
  },
  {
    slug: 'chasunos', name: 'Chasunos', title: 'Chasuna Transportation: Buses, Trolleys and Limos', h1: 'Transportation for chasunos',
    desc: 'Buses, trolleys and a limo for chasunos: guests from the hotel to the hall and back, on a time that holds.',
    lead: 'Guests need to arrive on time and get home safely. We quote the shuttle runs with the times you give us.',
    sections: [
      { h: 'Shuttles for guests', p: ['Tell us the pickup spots, the hall and the time of the chuppah. We plan the runs and the return, and put each one on the quote.'] },
      { h: 'Something special', p: ['Our fleet includes trolleys and a Hummer limo for the families who want a ride with some style. See the fleet page for seat counts and amenities.'] },
    ],
    faq: [
      { q: 'Can the bus wait at the hall?', a: 'Yes. Waiting time is listed on the quote.' },
      { q: 'Do you check the date against Shabbos?', a: 'Yes. We check every date against candle lighting and havdalah.' },
    ],
  },
  {
    slug: 'simchos', name: 'Simchos and party buses', title: 'Party Buses for Simchos', h1: 'Party buses for simchos',
    desc: 'Party buses and trolleys for bar mitzvahs, sheva brachos, vachtnachts and family events.',
    lead: 'Bar mitzvah outings, sheva brachos, vachtnachts and family events call for a vehicle that is part of the celebration.',
    sections: [
      { h: 'The party bus fleet', p: ['Our party buses seat 33 to 50 and include sound systems, lighting, TVs and bars. Some have a restroom on board. Each vehicle page lists what is in it.'] },
      { h: 'Trolleys and limo', p: ['For a smaller group we have trolleys and a Hummer limo. Share a vehicle page with your family using the share button.'] },
    ],
    faq: [
      { q: 'Are the amenities the same on every bus?', a: 'No. Each vehicle has its own list. Check the vehicle page and tell us what matters to you.' },
      { q: 'How do we book?', a: 'Send the request form with the date, times and stops. We reply with a price.' },
    ],
  },
  {
    slug: 'airport-transfers', name: 'Group airport transfers', title: 'Group Airport Transfers by Bus', h1: 'Group airport transfers',
    desc: 'Group airport transfers by bus: send the flight time and the pickup, and we plan around delays.',
    lead: 'Groups travelling together can share one vehicle to or from the airport.',
    sections: [
      { h: 'Plan around the flight', p: ['Give us the flight time and the pickup or drop-off address. If a flight is delayed, call the office and we will talk to the operator.'] },
    ],
    faq: [
      { q: 'Do you do single car or sprinter rides?', a: 'We focus on buses, trolleys and party vehicles for groups. Ask us and we will tell you what we can do.' },
    ],
  },
];
