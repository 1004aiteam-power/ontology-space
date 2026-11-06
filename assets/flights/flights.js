// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 세계 항공 교통 시뮬레이션 코어 (화면 없이 동작 → 테스트 가능)
//
//  - 실제 주요 공항(위치·시간대는 대략값)과 가상 항공사, 매일 반복되는 가상 운항 일정
//  - 항공기 위치는 시각만으로 계산: 출발 시각부터 지난 시간 → 진행률 → 대권 항로 위의 점·고도·속도
//    (그래서 시간을 앞뒤로 옮겨도 바로 그 순간의 하늘을 그릴 수 있음)
//  - 국내선 = 같은 나라(지역) 안의 공항끼리, 국제선 = 다른 나라끼리. 홍콩·마카오·대만은 별도 지역으로 셈
//  - 모든 무작위는 시드 난수 → 같은 시드면 같은 일정

// [코드, 한글, 영문, 나라(지역), 위도, 경도, UTC 시차(표준시), 등급 1~3 (1 = 대형 허브)]
const RAW = [
  // 한국
  ['ICN', '인천', 'Incheon', 'KR', 37.4602, 126.4407, 9, 1], ['GMP', '김포', 'Gimpo', 'KR', 37.5583, 126.7906, 9, 2], ['CJU', '제주', 'Jeju', 'KR', 33.5113, 126.4930, 9, 2],
  ['PUS', '김해', 'Gimhae', 'KR', 35.1795, 128.9382, 9, 2], ['CJJ', '청주', 'Cheongju', 'KR', 36.7166, 127.4991, 9, 3], ['TAE', '대구', 'Daegu', 'KR', 35.8941, 128.6589, 9, 3],
  ['KWJ', '광주', 'Gwangju', 'KR', 35.1264, 126.8089, 9, 3], ['RSU', '여수', 'Yeosu', 'KR', 34.8423, 127.6169, 9, 3], ['USN', '울산', 'Ulsan', 'KR', 35.5935, 129.3518, 9, 3],
  ['KPO', '포항경주', 'Pohang', 'KR', 35.9879, 129.4204, 9, 3], ['YNY', '양양', 'Yangyang', 'KR', 38.0613, 128.6692, 9, 3],
  // 일본
  ['HND', '도쿄 하네다', 'Tokyo Haneda', 'JP', 35.5494, 139.7798, 9, 1], ['NRT', '도쿄 나리타', 'Tokyo Narita', 'JP', 35.7720, 140.3929, 9, 1], ['KIX', '오사카 간사이', 'Osaka Kansai', 'JP', 34.4347, 135.2440, 9, 1],
  ['ITM', '오사카 이타미', 'Osaka Itami', 'JP', 34.7855, 135.4382, 9, 2], ['NGO', '나고야', 'Nagoya', 'JP', 34.8584, 136.8054, 9, 2], ['FUK', '후쿠오카', 'Fukuoka', 'JP', 33.5859, 130.4510, 9, 2],
  ['CTS', '삿포로', 'Sapporo', 'JP', 42.7752, 141.6923, 9, 2], ['OKA', '오키나와', 'Okinawa', 'JP', 26.1958, 127.6459, 9, 2], ['SDJ', '센다이', 'Sendai', 'JP', 38.1397, 140.9170, 9, 3],
  ['HIJ', '히로시마', 'Hiroshima', 'JP', 34.4361, 132.9195, 9, 3], ['KOJ', '가고시마', 'Kagoshima', 'JP', 31.8034, 130.7194, 9, 3],
  // 중국·홍콩·마카오·대만·몽골
  ['PEK', '베이징 서우두', 'Beijing Capital', 'CN', 40.0799, 116.6031, 8, 1], ['PKX', '베이징 다싱', 'Beijing Daxing', 'CN', 39.5098, 116.4105, 8, 1], ['PVG', '상하이 푸둥', 'Shanghai Pudong', 'CN', 31.1443, 121.8083, 8, 1],
  ['SHA', '상하이 훙차오', 'Shanghai Hongqiao', 'CN', 31.1979, 121.3363, 8, 2], ['CAN', '광저우', 'Guangzhou', 'CN', 23.3924, 113.2988, 8, 1], ['SZX', '선전', 'Shenzhen', 'CN', 22.6393, 113.8107, 8, 2],
  ['CTU', '청두', 'Chengdu', 'CN', 30.5785, 103.9471, 8, 2], ['CKG', '충칭', 'Chongqing', 'CN', 29.7192, 106.6417, 8, 2], ['XIY', '시안', "Xi'an", 'CN', 34.4471, 108.7516, 8, 2],
  ['KMG', '쿤밍', 'Kunming', 'CN', 25.1019, 102.9292, 8, 2], ['HGH', '항저우', 'Hangzhou', 'CN', 30.2295, 120.4345, 8, 2], ['WUH', '우한', 'Wuhan', 'CN', 30.7838, 114.2081, 8, 3],
  ['CSX', '창사', 'Changsha', 'CN', 28.1892, 113.2196, 8, 3], ['XMN', '샤먼', 'Xiamen', 'CN', 24.5440, 118.1277, 8, 3], ['TAO', '칭다오', 'Qingdao', 'CN', 36.3618, 120.0880, 8, 3],
  ['DLC', '다롄', 'Dalian', 'CN', 38.9657, 121.5386, 8, 3], ['SHE', '선양', 'Shenyang', 'CN', 41.6398, 123.4833, 8, 3], ['HRB', '하얼빈', 'Harbin', 'CN', 45.6234, 126.2503, 8, 3],
  ['URC', '우루무치', 'Urumqi', 'CN', 43.9071, 87.4742, 8, 3], ['HAK', '하이커우', 'Haikou', 'CN', 19.9349, 110.4589, 8, 3], ['SYX', '싼야', 'Sanya', 'CN', 18.3029, 109.4122, 8, 3],
  ['HKG', '홍콩', 'Hong Kong', 'HK', 22.3080, 113.9185, 8, 1], ['MFM', '마카오', 'Macau', 'MO', 22.1496, 113.5915, 8, 3],
  ['TPE', '타이베이 타오위안', 'Taipei Taoyuan', 'TW', 25.0797, 121.2342, 8, 2], ['TSA', '타이베이 쑹산', 'Taipei Songshan', 'TW', 25.0694, 121.5525, 8, 3], ['KHH', '가오슝', 'Kaohsiung', 'TW', 22.5771, 120.3500, 8, 3],
  ['UBN', '울란바토르', 'Ulaanbaatar', 'MN', 47.6467, 106.8200, 8, 3],
  // 동남아시아
  ['SIN', '싱가포르', 'Singapore', 'SG', 1.3644, 103.9915, 8, 1], ['BKK', '방콕 수완나품', 'Bangkok', 'TH', 13.6900, 100.7501, 7, 1], ['DMK', '방콕 돈므앙', 'Bangkok Don Mueang', 'TH', 13.9126, 100.6068, 7, 2],
  ['HKT', '푸껫', 'Phuket', 'TH', 8.1132, 98.3169, 7, 3], ['CNX', '치앙마이', 'Chiang Mai', 'TH', 18.7668, 98.9626, 7, 3], ['KUL', '쿠알라룸푸르', 'Kuala Lumpur', 'MY', 2.7456, 101.7072, 8, 1],
  ['BKI', '코타키나발루', 'Kota Kinabalu', 'MY', 5.9372, 116.0510, 8, 3], ['PEN', '페낭', 'Penang', 'MY', 5.2971, 100.2770, 8, 3], ['CGK', '자카르타', 'Jakarta', 'ID', -6.1256, 106.6559, 7, 1],
  ['DPS', '발리', 'Bali', 'ID', -8.7482, 115.1671, 8, 2], ['SUB', '수라바야', 'Surabaya', 'ID', -7.3798, 112.7869, 7, 3], ['UPG', '마카사르', 'Makassar', 'ID', -5.0616, 119.5540, 8, 3],
  ['MNL', '마닐라', 'Manila', 'PH', 14.5086, 121.0198, 8, 1], ['CEB', '세부', 'Cebu', 'PH', 10.3075, 123.9794, 8, 3], ['SGN', '호찌민', 'Ho Chi Minh City', 'VN', 10.8188, 106.6520, 7, 2],
  ['HAN', '하노이', 'Hanoi', 'VN', 21.2212, 105.8072, 7, 2], ['DAD', '다낭', 'Da Nang', 'VN', 16.0439, 108.1994, 7, 3], ['PNH', '프놈펜', 'Phnom Penh', 'KH', 11.5466, 104.8441, 7, 3],
  ['RGN', '양곤', 'Yangon', 'MM', 16.9073, 96.1332, 6.5, 3],
  // 남아시아
  ['DEL', '델리', 'Delhi', 'IN', 28.5562, 77.1000, 5.5, 1], ['BOM', '뭄바이', 'Mumbai', 'IN', 19.0896, 72.8656, 5.5, 1], ['BLR', '벵갈루루', 'Bengaluru', 'IN', 13.1986, 77.7066, 5.5, 2],
  ['MAA', '첸나이', 'Chennai', 'IN', 12.9941, 80.1709, 5.5, 2], ['CCU', '콜카타', 'Kolkata', 'IN', 22.6547, 88.4467, 5.5, 2], ['HYD', '하이데라바드', 'Hyderabad', 'IN', 17.2403, 78.4294, 5.5, 2],
  ['CMB', '콜롬보', 'Colombo', 'LK', 7.1808, 79.8841, 5.5, 3], ['KTM', '카트만두', 'Kathmandu', 'NP', 27.6966, 85.3591, 5.75, 3], ['DAC', '다카', 'Dhaka', 'BD', 23.8433, 90.3978, 6, 3],
  // 중동·튀르키예·북아프리카
  ['DXB', '두바이', 'Dubai', 'AE', 25.2532, 55.3657, 4, 1], ['AUH', '아부다비', 'Abu Dhabi', 'AE', 24.4330, 54.6511, 4, 2], ['DOH', '도하', 'Doha', 'QA', 25.2731, 51.6081, 3, 1],
  ['RUH', '리야드', 'Riyadh', 'SA', 24.9576, 46.6988, 3, 2], ['JED', '제다', 'Jeddah', 'SA', 21.6796, 39.1565, 3, 2], ['IST', '이스탄불', 'Istanbul', 'TR', 41.2753, 28.7519, 3, 1],
  ['SAW', '이스탄불 사비하', 'Istanbul Sabiha', 'TR', 40.8986, 29.3092, 3, 3], ['AYT', '안탈리아', 'Antalya', 'TR', 36.8987, 30.8005, 3, 3], ['ESB', '앙카라', 'Ankara', 'TR', 40.1281, 32.9951, 3, 3],
  ['TLV', '텔아비브', 'Tel Aviv', 'IL', 32.0055, 34.8854, 2, 3], ['CAI', '카이로', 'Cairo', 'EG', 30.1219, 31.4056, 2, 2], ['AMM', '암만', 'Amman', 'JO', 31.7226, 35.9932, 3, 3],
  ['CMN', '카사블랑카', 'Casablanca', 'MA', 33.3675, -7.5898, 1, 3], ['ALG', '알제', 'Algiers', 'DZ', 36.6910, 3.2154, 1, 3],
  // 유럽
  ['LHR', '런던 히스로', 'London Heathrow', 'GB', 51.4700, -0.4543, 0, 1], ['LGW', '런던 개트윅', 'London Gatwick', 'GB', 51.1537, -0.1821, 0, 2], ['MAN', '맨체스터', 'Manchester', 'GB', 53.3537, -2.2750, 0, 3],
  ['EDI', '에든버러', 'Edinburgh', 'GB', 55.9500, -3.3725, 0, 3], ['CDG', '파리 샤를드골', 'Paris CDG', 'FR', 49.0097, 2.5479, 1, 1], ['ORY', '파리 오를리', 'Paris Orly', 'FR', 48.7262, 2.3652, 1, 3],
  ['NCE', '니스', 'Nice', 'FR', 43.6584, 7.2159, 1, 3], ['LYS', '리옹', 'Lyon', 'FR', 45.7256, 5.0811, 1, 3], ['FRA', '프랑크푸르트', 'Frankfurt', 'DE', 50.0379, 8.5622, 1, 1],
  ['MUC', '뮌헨', 'Munich', 'DE', 48.3537, 11.7750, 1, 2], ['BER', '베를린', 'Berlin', 'DE', 52.3667, 13.5033, 1, 3], ['HAM', '함부르크', 'Hamburg', 'DE', 53.6304, 9.9882, 1, 3],
  ['AMS', '암스테르담', 'Amsterdam', 'NL', 52.3105, 4.7683, 1, 1], ['MAD', '마드리드', 'Madrid', 'ES', 40.4983, -3.5676, 1, 1], ['BCN', '바르셀로나', 'Barcelona', 'ES', 41.2974, 2.0833, 1, 2],
  ['PMI', '팔마', 'Palma', 'ES', 39.5517, 2.7388, 1, 3], ['FCO', '로마', 'Rome', 'IT', 41.8003, 12.2389, 1, 2], ['MXP', '밀라노', 'Milan', 'IT', 45.6306, 8.7281, 1, 2],
  ['ZRH', '취리히', 'Zurich', 'CH', 47.4582, 8.5555, 1, 2], ['VIE', '빈', 'Vienna', 'AT', 48.1103, 16.5697, 1, 2], ['CPH', '코펜하겐', 'Copenhagen', 'DK', 55.6180, 12.6508, 1, 2],
  ['ARN', '스톡홀름', 'Stockholm', 'SE', 59.6519, 17.9186, 1, 3], ['OSL', '오슬로', 'Oslo', 'NO', 60.1976, 11.1004, 1, 3], ['HEL', '헬싱키', 'Helsinki', 'FI', 60.3172, 24.9633, 2, 2],
  ['DUB', '더블린', 'Dublin', 'IE', 53.4264, -6.2499, 0, 2], ['LIS', '리스본', 'Lisbon', 'PT', 38.7742, -9.1342, 0, 2], ['WAW', '바르샤바', 'Warsaw', 'PL', 52.1657, 20.9671, 1, 3],
  ['ATH', '아테네', 'Athens', 'GR', 37.9364, 23.9445, 2, 3], ['PRG', '프라하', 'Prague', 'CZ', 50.1008, 14.2600, 1, 3], ['BRU', '브뤼셀', 'Brussels', 'BE', 50.9010, 4.4844, 1, 3],
  ['SVO', '모스크바', 'Moscow', 'RU', 55.9726, 37.4146, 3, 2], ['LED', '상트페테르부르크', 'St Petersburg', 'RU', 59.8003, 30.2625, 3, 3], ['OVB', '노보시비르스크', 'Novosibirsk', 'RU', 55.0126, 82.6507, 7, 3],
  ['VVO', '블라디보스토크', 'Vladivostok', 'RU', 43.3990, 132.1480, 10, 3],
  // 아프리카
  ['JNB', '요하네스버그', 'Johannesburg', 'ZA', -26.1392, 28.2460, 2, 2], ['CPT', '케이프타운', 'Cape Town', 'ZA', -33.9715, 18.6021, 2, 3], ['ADD', '아디스아바바', 'Addis Ababa', 'ET', 8.9779, 38.7993, 3, 2],
  ['NBO', '나이로비', 'Nairobi', 'KE', -1.3192, 36.9278, 3, 2], ['LOS', '라고스', 'Lagos', 'NG', 6.5774, 3.3212, 1, 3],
  // 북아메리카
  ['ATL', '애틀랜타', 'Atlanta', 'US', 33.6407, -84.4277, -5, 1], ['LAX', '로스앤젤레스', 'Los Angeles', 'US', 33.9416, -118.4085, -8, 1], ['ORD', '시카고', 'Chicago', 'US', 41.9742, -87.9073, -6, 1],
  ['DFW', '댈러스', 'Dallas', 'US', 32.8998, -97.0403, -6, 1], ['DEN', '덴버', 'Denver', 'US', 39.8561, -104.6737, -7, 2], ['JFK', '뉴욕 JFK', 'New York JFK', 'US', 40.6413, -73.7781, -5, 1],
  ['SFO', '샌프란시스코', 'San Francisco', 'US', 37.6213, -122.3790, -8, 1], ['SEA', '시애틀', 'Seattle', 'US', 47.4502, -122.3088, -8, 2], ['LAS', '라스베이거스', 'Las Vegas', 'US', 36.0840, -115.1537, -8, 2],
  ['MCO', '올랜도', 'Orlando', 'US', 28.4312, -81.3081, -5, 2], ['MIA', '마이애미', 'Miami', 'US', 25.7959, -80.2870, -5, 2], ['IAH', '휴스턴', 'Houston', 'US', 29.9902, -95.3368, -6, 2],
  ['BOS', '보스턴', 'Boston', 'US', 42.3656, -71.0096, -5, 2], ['EWR', '뉴어크', 'Newark', 'US', 40.6895, -74.1745, -5, 2], ['PHX', '피닉스', 'Phoenix', 'US', 33.4342, -112.0116, -7, 2],
  ['MSP', '미니애폴리스', 'Minneapolis', 'US', 44.8848, -93.2223, -6, 3], ['DTW', '디트로이트', 'Detroit', 'US', 42.2162, -83.3554, -5, 3], ['CLT', '샬럿', 'Charlotte', 'US', 35.2144, -80.9473, -5, 2],
  ['IAD', '워싱턴 덜레스', 'Washington Dulles', 'US', 38.9531, -77.4565, -5, 2], ['HNL', '호놀룰루', 'Honolulu', 'US', 21.3245, -157.9251, -10, 2], ['ANC', '앵커리지', 'Anchorage', 'US', 61.1743, -149.9962, -9, 3],
  ['SLC', '솔트레이크시티', 'Salt Lake City', 'US', 40.7899, -111.9791, -7, 3], ['PHL', '필라델피아', 'Philadelphia', 'US', 39.8744, -75.2424, -5, 3],
  ['YYZ', '토론토', 'Toronto', 'CA', 43.6777, -79.6248, -5, 1], ['YVR', '밴쿠버', 'Vancouver', 'CA', 49.1967, -123.1815, -8, 2], ['YUL', '몬트리올', 'Montreal', 'CA', 45.4706, -73.7408, -5, 2],
  ['YYC', '캘거리', 'Calgary', 'CA', 51.1215, -114.0076, -7, 3],
  // 중남미
  ['MEX', '멕시코시티', 'Mexico City', 'MX', 19.4361, -99.0719, -6, 1], ['CUN', '칸쿤', 'Cancun', 'MX', 21.0365, -86.8771, -5, 2], ['GDL', '과달라하라', 'Guadalajara', 'MX', 20.5218, -103.3112, -6, 3],
  ['MTY', '몬테레이', 'Monterrey', 'MX', 25.7785, -100.1069, -6, 3], ['GRU', '상파울루', 'Sao Paulo', 'BR', -23.4356, -46.4731, -3, 1], ['GIG', '리우데자네이루', 'Rio de Janeiro', 'BR', -22.8090, -43.2506, -3, 2],
  ['BSB', '브라질리아', 'Brasilia', 'BR', -15.8697, -47.9208, -3, 3], ['EZE', '부에노스아이레스', 'Buenos Aires', 'AR', -34.8222, -58.5358, -3, 2], ['SCL', '산티아고', 'Santiago', 'CL', -33.3930, -70.7858, -4, 2],
  ['LIM', '리마', 'Lima', 'PE', -12.0219, -77.1143, -5, 2], ['BOG', '보고타', 'Bogota', 'CO', 4.7016, -74.1469, -5, 2], ['PTY', '파나마시티', 'Panama City', 'PA', 9.0714, -79.3835, -5, 2],
  // 오세아니아
  ['SYD', '시드니', 'Sydney', 'AU', -33.9399, 151.1753, 10, 1], ['MEL', '멜버른', 'Melbourne', 'AU', -37.6690, 144.8410, 10, 2], ['BNE', '브리즈번', 'Brisbane', 'AU', -27.3842, 153.1175, 10, 2],
  ['PER', '퍼스', 'Perth', 'AU', -31.9385, 115.9672, 8, 3], ['AKL', '오클랜드', 'Auckland', 'NZ', -37.0082, 174.7850, 12, 2], ['CHC', '크라이스트처치', 'Christchurch', 'NZ', -43.4894, 172.5320, 12, 3],
  ['NAN', '난디', 'Nadi', 'FJ', -17.7554, 177.4434, 12, 3]
];
export const AIRPORTS = RAW.map(([code, ko, en, cc, lat, lon, tz, tier]) => ({ code, name: { ko, en }, cc, lat, lon, tz, tier }));
export const BY_CODE = Object.fromEntries(AIRPORTS.map(a => [a.code, a]));

// 가상 항공사 (실제 항공사와 관계없음). home: 주로 운항하는 나라(지역)
export const AIRLINES = [
  { code: 'NR', name: { ko: '누리항공', en: 'Nuri Air' }, home: ['KR'] },
  { code: 'BD', name: { ko: '바다항공', en: 'Bada Air' }, home: ['KR'] },
  { code: 'SL', name: { ko: '솔항공', en: 'Sol Air' }, home: ['KR'] },
  { code: 'HD', name: { ko: '히노데항공', en: 'Hinode Air' }, home: ['JP'] },
  { code: 'LY', name: { ko: '룽윈항공', en: 'Longyun Air' }, home: ['CN', 'MN'] },
  { code: 'JD', name: { ko: '제이드항공', en: 'Jade Air' }, home: ['HK', 'MO', 'TW'] },
  { code: 'MS', name: { ko: '몬순항공', en: 'Monsoon Air' }, home: ['SG', 'TH', 'MY', 'ID', 'PH', 'VN', 'KH', 'MM'] },
  { code: 'LT', name: { ko: '로터스항공', en: 'Lotus Air' }, home: ['IN', 'LK', 'NP', 'BD'] },
  { code: 'OS', name: { ko: '오아시스항공', en: 'Oasis Airways' }, home: ['AE', 'QA', 'SA', 'IL', 'EG', 'JO', 'MA', 'DZ', 'TR'] },
  { code: 'EL', name: { ko: '유로리스', en: 'Eurolys' }, home: ['GB', 'FR', 'DE', 'NL', 'ES', 'IT', 'CH', 'AT', 'DK', 'SE', 'NO', 'FI', 'IE', 'PT', 'PL', 'GR', 'CZ', 'BE'] },
  { code: 'TG', name: { ko: '타이가항공', en: 'Taiga Air' }, home: ['RU'] },
  { code: 'SV', name: { ko: '사바나항공', en: 'Savanna Air' }, home: ['ZA', 'ET', 'KE', 'NG'] },
  { code: 'LS', name: { ko: '리버티스카이', en: 'Liberty Skies' }, home: ['US'] },
  { code: 'PC', name: { ko: '파인크레스트항공', en: 'Pinecrest Air' }, home: ['US', 'CA'] },
  { code: 'AS', name: { ko: '안데스수르', en: 'Andes Sur' }, home: ['MX', 'BR', 'AR', 'CL', 'PE', 'CO', 'PA'] },
  { code: 'CR', name: { ko: '코랄항공', en: 'Coral Air' }, home: ['AU', 'NZ', 'FJ'] }
];
const CARRIERS = {};
for (const al of AIRLINES) for (const cc of al.home) (CARRIERS[cc] ||= []).push(al);

// 기체 분류 (실제 기종 대신 크기만)
export const KINDS = {
  prop: { ko: '터보프롭', en: 'Turboprop' },
  narrow: { ko: '협동체 제트기', en: 'Narrow-body jet' },
  wide: { ko: '광동체 제트기', en: 'Wide-body jet' }
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 구면 계산 --------------------------------------------------------------------
const R_EARTH = 6371;
const RAD = Math.PI / 180;
const vec = (lat, lon) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
export function gcDist(a, b) {                                  // 대권 거리 (km)
  const dlat = (b.lat - a.lat) * RAD, dlon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dlon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
// 대권 위의 점 (f = 0..1)
export function gcPoint(a, b, f) {
  const p = vec(a.lat, a.lon), q = vec(b.lat, b.lon);
  const d = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * p[0] + B * q[0], y = A * p[1] + B * q[1], z = A * p[2] + B * q[2];
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
}
// 진행 방향 (북쪽 기준 시계방향, 도)
export function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
// 해가 머리 위에 있는 지점 (낮·밤 경계 그리기용, 균시차는 무시)
export function subsolar(tSec) {
  const d = new Date(tSec * 1000);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0), doy = (d.getTime() - start) / 86400000;
  const decl = -23.44 * Math.cos(2 * Math.PI / 365 * (doy + 10));
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return { lat: decl, lon: ((12 - utcH) * 15 + 540) % 360 - 180 };
}

// ---- 운항 일정 ---------------------------------------------------------------------
export const DEFAULTS = { seed: 2026, density: 1 };
// 특히 붐비는 노선 (하루 편수 배율)
const TRUNK = { 'GMP-CJU': 20, 'CJU-PUS': 4, 'GMP-PUS': 4, 'CJU-CJJ': 3, 'CJU-TAE': 3, 'CJU-KWJ': 2, 'HND-CTS': 4, 'HND-FUK': 4, 'HND-ITM': 3, 'HND-OKA': 2.5, 'PEK-SHA': 3, 'CAN-PEK': 2, 'SZX-PEK': 1.5, 'MEL-SYD': 4, 'BNE-SYD': 2.5,
  'LAX-SFO': 2.5, 'JFK-LAX': 2, 'TPE-HKG': 3, 'HKG-TPE': 3, 'ICN-NRT': 2.5, 'ICN-KIX': 2.5, 'ICN-FUK': 2, 'ICN-PVG': 2, 'ICN-PEK': 1.5, 'BKK-HKG': 1.5, 'CGK-SIN': 2, 'KUL-SIN': 3, 'DEL-BOM': 3, 'MAD-BCN': 2.5, 'GIG-GRU': 3, 'YUL-YYZ': 2 };
const trunkKey = (a, b) => [a, b].sort().join('-');
for (const k of Object.keys(TRUNK)) { const n = trunkKey(...k.split('-')); if (n !== k) { TRUNK[n] = Math.max(TRUNK[n] || 0, TRUNK[k]); delete TRUNK[k]; } }

export function buildSchedule(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rand = rng(cfg.seed);
  const W = { 1: 3, 2: 2, 3: 1 };
  const routes = [];
  for (let i = 0; i < AIRPORTS.length; i++) for (let j = i + 1; j < AIRPORTS.length; j++) {
    const a = AIRPORTS[i], b = AIRPORTS[j], d = gcDist(a, b);
    const dom = a.cc === b.cc;
    if (d < 180) continue;                                       // 너무 가까운 공항끼리는 노선 없음 (예: 홍콩–선전)
    let freq = 0;
    if (dom) {
      freq = 0.95 * W[a.tier] * W[b.tier] * (d < 2500 ? 1 : 0.6);
      if (a.code === 'ICN' || b.code === 'ICN' || a.code === 'NRT' || b.code === 'NRT' || a.code === 'PVG' || b.code === 'PVG') freq *= 0.2;   // 국제선 중심 공항
      if (a.tier === 3 && b.tier === 3 && d > 1200) freq *= 0.3;
    } else {
      const t = [a.tier, b.tier].sort().join('');
      const rule = { 11: [15500, 1], 12: [10000, 0.8], 13: [5000, 0.55], 22: [4000, 0.6], 23: [2200, 0.4], 33: [1300, 0.25] }[t];
      if (!(d < rule[0] && rand() < rule[1])) continue;
      freq = (W[a.tier] * W[b.tier]) / 3 * (d < 1500 ? 1.4 : d < 5000 ? 0.9 : 0.55);
      if (a.code === 'GMP' || b.code === 'GMP' || a.code === 'ITM' || b.code === 'ITM' || a.code === 'SHA' || b.code === 'SHA' || a.code === 'TSA' || b.code === 'TSA') freq *= 0.35;
    }
    freq *= TRUNK[trunkKey(a.code, b.code)] || 1;
    const n = Math.max(1, Math.round(freq * cfg.density * (0.7 + 0.6 * rand())));
    routes.push({ a, b, d, dom, n });
  }
  // 편 만들기: 양방향, 현지 시각 기준으로 출발
  const flights = [], used = new Set();
  for (const r of routes) for (const [o, x] of [[r.a, r.b], [r.b, r.a]]) {
    const long = r.d > 4500;
    const pool = r.dom ? (CARRIERS[o.cc] || AIRLINES) : (rand() < 0.5 ? CARRIERS[o.cc] : CARRIERS[x.cc]) || AIRLINES;
    for (let k = 0; k < r.n; k++) {
      // 단거리: 06:30~22:30 사이에 고르게 나눠 같은 노선 편끼리 겹치지 않게, 장거리: 낮 또는 밤 출발
      const local = long ? (rand() < 0.55 ? 9.5 + rand() * 5 : 18.5 + rand() * 6) : 6.5 + (k + 0.15 + 0.7 * rand()) / r.n * 16;
      const depTod = ((Math.round(((local - o.tz) * 3600) / 300) * 300 % 86400) + 86400) % 86400;   // 5분 단위
      const al = pool[(rand() * pool.length) | 0];
      let no, tries = 0;                                        // 국내선 100~4999, 국제선 5000~9999 (모자라면 범위를 넓힘)
      do { const wide = tries++ > 40; no = al.code + (wide ? 10000 + ((rand() * 90000) | 0) : r.dom ? 100 + ((rand() * 4900) | 0) : 5000 + ((rand() * 5000) | 0)); } while (used.has(no));
      used.add(no);
      flights.push(makeFlight(o, x, r, depTod, al, no, rand));
    }
  }
  flights.sort((p, q) => p.depTod - q.depTod);
  flights.forEach((f, i) => { f.id = i; });
  return { routes, flights, cfg };
}
function makeFlight(o, x, r, depTod, al, no, rand) {
  const kind = r.d < 600 && rand() < 0.35 ? 'prop' : r.d > 5000 ? 'wide' : (r.d > 2500 && rand() < 0.4 ? 'wide' : 'narrow');
  const cruiseKmh = kind === 'prop' ? 500 : 840;
  // 편서풍: 동쪽으로 갈 때 빠르고 서쪽으로 갈 때 느림 (중위도에서 강함)
  const east = Math.sin(bearing(o, x) * RAD), midLat = Math.abs(o.lat + x.lat) / 2;
  const wind = 1 + 0.07 * east * Math.min(1, midLat / 35);
  const gs = cruiseKmh * wind;
  const dur = Math.round((r.d / gs) * 3600 + (kind === 'prop' ? 900 : 1500));   // 이착륙 구간 여유 15~25분
  const cruiseAlt = Math.min(kind === 'prop' ? 7500 : 11600, 2500 + r.d * (kind === 'prop' ? 12 : 9));
  const P = vec(o.lat, o.lon), Q = vec(x.lat, x.lon), ang = Math.acos(Math.max(-1, Math.min(1, P[0] * Q[0] + P[1] * Q[1] + P[2] * Q[2])));
  return { o, x, d: r.d, dom: r.dom, depTod, dur, al, no, kind, gs, cruiseAlt, P, Q, ang, sinA: Math.sin(ang) };   // P·Q·ang: 빠른 위치 계산용
}
// 대권 위 위치와 진행 방향 (미리 계산한 벡터로 빠르게)
function fastPoint(f, k) {
  const A = Math.sin((1 - k) * f.ang) / f.sinA, B = Math.sin(k * f.ang) / f.sinA;
  const x = A * f.P[0] + B * f.Q[0], y = A * f.P[1] + B * f.Q[1], z = A * f.P[2] + B * f.Q[2];
  const lat = Math.atan2(z, Math.hypot(x, y)), lon = Math.atan2(y, x);
  // 접선 방향 → 북쪽·동쪽 성분 → 방위각
  const dA = -Math.cos((1 - k) * f.ang), dB = Math.cos(k * f.ang);
  const tx = dA * f.P[0] + dB * f.Q[0], ty = dA * f.P[1] + dB * f.Q[1], tz = dA * f.P[2] + dB * f.Q[2];
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  const north = -sl * co * tx - sl * so * ty + cl * tz, east = -so * tx + co * ty;
  return { lat: lat / RAD, lon: lon / RAD, hd: (Math.atan2(east, north) / RAD + 360) % 360 };
}

// ---- 어느 순간의 상태 ----------------------------------------------------------------
// 출발 후 경과 시간 → 진행률·고도·속도. 상승 20분, 강하 25분 (짧은 비행은 비율로 줄임)
export function profile(f, el) {
  const T = f.dur, up = Math.min(1200, T * 0.3), down = Math.min(1500, T * 0.35);
  const vc = f.gs / 3.6, v0 = vc * 0.45;                        // m/s
  // 거리: 상승·강하 구간은 평균 속도 (v0+vc)/2, 순항은 vc → 전체 거리에 맞게 정규화
  const dUp = up * (v0 + vc) / 2, dDown = down * (v0 + vc) / 2, dCr = Math.max(0, T - up - down) * vc, total = dUp + dCr + dDown;
  let s, v, alt;
  if (el < up) { const k = el / up; v = v0 + (vc - v0) * k; s = el * (v0 + v) / 2; alt = f.cruiseAlt * Math.sin(k * Math.PI / 2); }
  else if (el < T - down) { v = vc; s = dUp + (el - up) * vc; alt = f.cruiseAlt; }
  else { const k = (el - (T - down)) / down; v = vc + (v0 - vc) * k; s = dUp + dCr + (el - (T - down)) * (vc + v) / 2; alt = f.cruiseAlt * Math.cos(k * Math.PI / 2); }
  return { p: Math.min(1, s / total), alt: Math.max(0, alt), v };
}
export function stateAt(f, t) {
  const el = ((t - f.depTod) % 86400 + 86400) % 86400;            // 가장 최근 출발로부터 지난 시간
  if (el >= f.dur) return null;
  const pr = profile(f, el), pos = fastPoint(f, pr.p);
  return { lat: pos.lat, lon: pos.lon, hd: pos.hd, alt: pr.alt, kmh: pr.v * 3.6, p: pr.p, dep: t - el, arr: t - el + f.dur };
}
export function airborne(flights, t, filter) {
  const out = [];
  for (const f of flights) {
    if ((((t - f.depTod) % 86400) + 86400) % 86400 >= f.dur) continue;   // 빠른 걸러내기
    if (filter && !filter(f)) continue;
    const s = stateAt(f, t);
    if (s) out.push({ f, s });
  }
  return out;
}
// 경로 점들 (지도에 그리기용)
export function routePoints(f, n = 64) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(gcPoint(f.o, f.x, i / n));
  return pts;
}
