"""The name pools every player in the league is drawn from.

Invented surnames and first names, deliberately not real people's. Two things
draw on them and both have to draw on the *same* pool, or the players who
arrive in an offseason read as a different nationality of person from the ones
already on the roster: the one-off generator that built `data/league.json`, and
the offseason intake in `bballsim/prospects.py`.

They lived in `placeholder.py` while the generator was the only thing making
players. The intake is not throwaway, so the pool moved somewhere that is not
either.

The pools are lists, not sets, and the order is load-bearing: they are sampled
from a seeded RNG, and Python salts string hashing per process, so iterating a
set would hand a different name to each slot on every run and the same seed
would build a different league tomorrow.
"""

from __future__ import annotations

# A twelve-man roster needs twelve unique surnames and a thirty-team league
# is 360 players, so the pool has to clear that with room to spare.
SURNAMES = [
    "Alder", "Brook", "Calloway", "Dunmore", "Ellery", "Fenwick", "Gale",
    "Hollis", "Ingram", "Jarvis", "Kessler", "Larkin", "Mercer", "Nash",
    "Oakes", "Prescott", "Quill", "Reyes", "Sparrow", "Thorne", "Underhill",
    "Vance", "Whitlock", "Yarrow", "Ashcroft", "Bellamy", "Cardew", "Dashiell",
    "Everly", "Fairbank", "Gossard", "Halloway", "Isley", "Jessup", "Kingsley",
    "Lathrop", "Marchetti", "Norwood", "Ostrander", "Pemberton", "Quintero",
    "Ravenel", "Sedgwick", "Tillman", "Ulmer", "Verlander", "Wexford",
    "Yates", "Ziegler", "Ainsworth", "Bramwell", "Colvin", "Denholm",
    "Eastwick", "Falkner", "Granger", "Hawthorne", "Ives", "Joplin",
    "Kirkwood", "Lindqvist", "Merriweather", "Nordstrom", "Osgood",
    "Pennington", "Quarles", "Rockwell", "Sandoval", "Trueblood", "Ulrich",
    "Vandermeer", "Wolcott", "Yeardley", "Zabala", "Amberly", "Blackwood",
    "Castellan", "Doverly", "Ellsworth", "Fitzhugh", "Galbraith", "Hartsock",
    "Inglewood", "Jansen", "Keswick", "Loudermilk", "Mainwaring", "Netherton",
    "Oxley", "Pathmore", "Quilliam", "Rutherford", "Stillwell", "Tanaka",
    "Uxbridge", "Vasquez", "Wentworth", "Yorke", "Zamora", "Abernathy",
    "Braddock", "Chaudhry", "Delacroix", "Emberly", "Fontaine", "Greaves",
    "Hallowell", "Ibarra", "Jelani", "Kowalczyk", "Lundqvist", "Moreau",
    "Nakamura", "Okonkwo", "Petrov", "Quinlan", "Rasmussen", "Solberg",
    "Takahashi", "Ustinov", "Villalobos", "Wagstaff", "Xiong", "Yamamoto",
    "Zielinski", "Ackerman", "Barrington", "Caldwell", "Draper", "Eberhardt",
    "Fairweather", "Gundersen", "Hollingsworth", "Iverson", "Jacoby",
    "Kaminski", "Langford", "Mattheson", "Novak", "Ortega", "Pankhurst",
    "Quesada", "Radcliffe", "Sorensen", "Thibodeaux", "Ugarte", "Voss",
    "Whittaker", "Yeoman", "Zaragoza", "Ashford", "Bexley", "Carrington",
    "Duquette", "Emerson", "Fitzgibbon", "Garrity", "Hendricks", "Ilyushin",
    "Jorgensen", "Kilpatrick", "Lockhart", "Montrose", "Nightingale",
    "Ordonez", "Paxton", "Quimby", "Ridgeway", "Stanhope", "Tremaine",
    "Upshaw", "Valdez", "Wilkerson", "Yancey", "Zeller", "Attwater",
    "Bergstrom", "Chandler", "Devereaux", "Eastgate", "Fairholm", "Gladwell",
    "Harrowgate", "Innsbruck", "Jankovic", "Kettering", "Lascelles",
    "Mortimer", "Nunnally", "Oldfield", "Pemberly", "Quillon", "Ravensworth",
    "Sinclair", "Thackeray", "Umbridge", "Vanderberg", "Whitmore", "Yelverton",
    "Zabriskie", "Alcott", "Bannerman", "Crowther", "Dunstable", "Eldridge",
    "Fothergill", "Goodwin", "Hargreaves", "Iremonger", "Jephson",
    "Kenworthy", "Lyttleton", "Marchbanks", "Nettlefold", "Ollerenshaw",
    "Prendergast", "Quennell", "Rowntree", "Standish", "Tattersall",
    "Underwood", "Vickery", "Wolstenholme", "Yardley", "Zouche", "Applegarth",
    "Birtwistle", "Cholmondeley", "Dalrymple", "Etheridge", "Farthingale",
    "Grimsditch", "Huddleston", "Ingoldsby", "Jerningham", "Kirkbride",
    "Loveridge", "Mallinson", "Ninnis", "Ogilvie", "Postlethwaite",
    "Quatermain", "Rushworth", "Snodgrass", "Thorneycroft", "Ubaldini",
    "Vansittart", "Wickersham", "Yoxall", "Zetterberg", "Aldington",
    "Blenkinsop", "Carmichael", "Dinsdale", "Ellerbeck", "Featherstone",
    "Gainsborough", "Hollingbourne", "Ickringill", "Jellicoe", "Kempthorne",
    "Lightfoot", "Micklethwaite", "Naismith", "Oglethorpe", "Pilkington",
    "Quantrill", "Ravenscroft", "Shackleton", "Trelawney", "Uttridge",
    "Verinder", "Winterbourne", "Yelland", "Zimmerman", "Arbuthnot",
    "Beauchamp", "Cadwallader", "Duckworth", "Endicott", "Fanshawe",
    "Garforth", "Hawksmoor", "Iddesleigh", "Joliffe", "Kirkpatrick",
    "Lansbury", "Meredith", "Nuttall", "Ottoline", "Popplewell", "Quilter",
    "Rickenbacker", "Somerville", "Templeton", "Urquhart", "Vivian",
    "Wolfenden", "Yeatman", "Zangwill", "Aberdeen", "Broadbent", "Culpepper",
    "Danvers", "Edgerton", "Fitzroy", "Glanville", "Havelock", "Isherwood",
    "Jardine", "Kilbride", "Lamplugh", "Mowbray", "Norrington", "Osbourne",
    "Prideaux", "Quiller", "Rasmusson", "Selwyn", "Thistlewood", "Ulverston",
    "Ventris", "Wadsworth", "Yelverley", "Zealand", "Ancaster", "Bickerstaff",
    "Cranleigh", "Devonport", "Ecclestone", "Fitzalan", "Godolphin",
    "Hazelwood", "Irvington", "Jessamine", "Kenilworth", "Lindisfarne",
    "Mandeville", "Northbrook", "Orpington", "Pendlebury", "Quorndon",
    "Rothesay", "Stapleton", "Tewkesbury", "Ullswater", "Vandeleur",
    "Wrottesley", "Yarborough", "Zennor", "Ashbourne", "Beddingfield",
    "Chelmsford", "Dunwoody", "Elphinstone", "Fairbrother", "Grosvenor",
    "Hartlepool", "Ilchester", "Jerviswood", "Knatchbull", "Lauderdale",
    "Marlborough", "Newcombe", "Oxenford", "Pontefract", "Quendon",
    "Ravenglass", "Strathmore", "Tunstall", "Uppingham", "Vereker",
    "Willoughby", "Yattendon", "Zouch",
]

FIRST_NAMES = [
    "Andre", "Bryce", "Cam", "Dante", "Elias", "Finn", "Gus", "Hector",
    "Isaiah", "Jonah", "Kai", "Luca", "Miles", "Noel", "Omar", "Pierce",
    "Quinn", "Rashad", "Silas", "Tobias", "Amari", "Brandon", "Caleb",
    "Damian", "Ezra", "Felix", "Gabriel", "Harun", "Ivan", "Jalen",
    "Kofi", "Lorenzo", "Malik", "Nikola", "Oscar", "Patrice", "Rafael",
    "Sebastian", "Tariq", "Vince", "Wesley", "Xavier", "Yusuf", "Zane",
    "Adrian", "Bilal", "Cole", "Diego", "Emmett", "Franco", "Grayson",
    "Hugo", "Idris", "Jasper", "Kenji", "Leonel", "Marcus", "Nathanael",
    "Oren", "Pavel", "Reuben", "Santiago", "Theo", "Ulrich", "Viktor",
    "Warren", "Yannick", "Zeke",
]
