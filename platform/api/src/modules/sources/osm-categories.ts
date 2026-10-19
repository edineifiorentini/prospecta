import { fold } from "../../lib/normalize.ts";

/** Mapeamento de nichos (pt-BR) para etiquetas do OpenStreetMap. */
type TagFilter = { key: string; value: string; extra?: string };

const MAP: Array<{ terms: string[]; label: string; tags: TagFilter[] }> = [
  { terms: ["dentista", "odontologia", "odontologico", "clinica odontologica", "dentist"], label: "Dentista", tags: [{ key: "amenity", value: "dentist" }, { key: "healthcare", value: "dentist" }] },
  { terms: ["clinica", "clinica medica", "consultorio", "medico", "clinic", "doctor"], label: "Clínica médica", tags: [{ key: "amenity", value: "clinic" }, { key: "amenity", value: "doctors" }, { key: "healthcare", value: "clinic" }, { key: "healthcare", value: "doctor" }] },
  { terms: ["farmacia", "drogaria", "pharmacy"], label: "Farmácia", tags: [{ key: "amenity", value: "pharmacy" }, { key: "healthcare", value: "pharmacy" }] },
  { terms: ["fisioterapia", "fisioterapeuta"], label: "Fisioterapia", tags: [{ key: "healthcare", value: "physiotherapist" }] },
  { terms: ["psicologo", "psicologia", "terapia"], label: "Psicologia", tags: [{ key: "healthcare", value: "psychotherapist" }, { key: "healthcare:speciality", value: "psychiatry" }] },
  { terms: ["laboratorio", "exames"], label: "Laboratório", tags: [{ key: "healthcare", value: "laboratory" }] },
  { terms: ["veterinario", "clinica veterinaria", "veterinaria", "vet"], label: "Veterinário", tags: [{ key: "amenity", value: "veterinary" }] },
  { terms: ["pet shop", "petshop", "pet"], label: "Pet shop", tags: [{ key: "shop", value: "pet" }, { key: "shop", value: "pet_grooming" }] },
  { terms: ["restaurante", "restaurant"], label: "Restaurante", tags: [{ key: "amenity", value: "restaurant" }] },
  { terms: ["pizzaria", "pizza"], label: "Pizzaria", tags: [{ key: "amenity", value: "restaurant", extra: '["cuisine"~"pizza",i]' }, { key: "amenity", value: "fast_food", extra: '["cuisine"~"pizza",i]' }] },
  { terms: ["hamburgueria", "hamburguer", "burger", "lanchonete", "fast food"], label: "Lanchonete", tags: [{ key: "amenity", value: "fast_food" }] },
  { terms: ["cafe", "cafeteria", "coffee"], label: "Cafeteria", tags: [{ key: "amenity", value: "cafe" }] },
  { terms: ["bar", "pub", "boteco", "choperia"], label: "Bar", tags: [{ key: "amenity", value: "bar" }, { key: "amenity", value: "pub" }] },
  { terms: ["sorveteria", "gelato", "acai"], label: "Sorveteria", tags: [{ key: "amenity", value: "ice_cream" }, { key: "shop", value: "ice_cream" }] },
  { terms: ["padaria", "confeitaria", "bakery"], label: "Padaria", tags: [{ key: "shop", value: "bakery" }, { key: "shop", value: "pastry" }] },
  { terms: ["acougue", "casa de carnes"], label: "Açougue", tags: [{ key: "shop", value: "butcher" }] },
  { terms: ["supermercado", "mercado", "mercearia", "minimercado"], label: "Supermercado", tags: [{ key: "shop", value: "supermarket" }, { key: "shop", value: "convenience" }, { key: "shop", value: "greengrocer" }] },
  { terms: ["academia", "crossfit", "pilates", "gym", "fitness"], label: "Academia", tags: [{ key: "leisure", value: "fitness_centre" }, { key: "leisure", value: "sports_centre" }] },
  { terms: ["salao de beleza", "cabeleireiro", "cabelereiro", "salao"], label: "Salão de beleza", tags: [{ key: "shop", value: "hairdresser" }, { key: "shop", value: "beauty" }] },
  { terms: ["barbearia", "barbeiro", "barber"], label: "Barbearia", tags: [{ key: "shop", value: "hairdresser", extra: '["name"~"barb",i]' }, { key: "shop", value: "barber" }] },
  { terms: ["estetica", "clinica de estetica", "manicure", "depilacao", "spa"], label: "Estética", tags: [{ key: "shop", value: "beauty" }, { key: "leisure", value: "spa" }] },
  { terms: ["advogado", "advocacia", "escritorio de advocacia", "lawyer"], label: "Advocacia", tags: [{ key: "office", value: "lawyer" }] },
  { terms: ["contabilidade", "contador", "escritorio contabil", "accountant"], label: "Contabilidade", tags: [{ key: "office", value: "accountant" }, { key: "office", value: "tax_advisor" }] },
  { terms: ["imobiliaria", "corretor de imoveis", "imoveis"], label: "Imobiliária", tags: [{ key: "office", value: "estate_agent" }, { key: "shop", value: "estate_agent" }] },
  { terms: ["arquiteto", "arquitetura"], label: "Arquitetura", tags: [{ key: "office", value: "architect" }] },
  { terms: ["seguradora", "corretora de seguros", "seguros"], label: "Seguros", tags: [{ key: "office", value: "insurance" }] },
  { terms: ["agencia de viagens", "turismo"], label: "Agência de viagens", tags: [{ key: "shop", value: "travel_agency" }, { key: "office", value: "travel_agent" }] },
  { terms: ["escola", "colegio", "school"], label: "Escola", tags: [{ key: "amenity", value: "school" }, { key: "amenity", value: "kindergarten" }] },
  { terms: ["curso", "escola de idiomas", "idiomas", "ingles"], label: "Escola de idiomas/cursos", tags: [{ key: "amenity", value: "language_school" }, { key: "amenity", value: "training" }] },
  { terms: ["autoescola", "auto escola", "cfc"], label: "Autoescola", tags: [{ key: "amenity", value: "driving_school" }] },
  { terms: ["oficina", "oficina mecanica", "mecanica", "auto center", "funilaria"], label: "Oficina mecânica", tags: [{ key: "shop", value: "car_repair" }, { key: "shop", value: "tyres" }] },
  { terms: ["autopecas", "auto pecas", "pecas automotivas"], label: "Autopeças", tags: [{ key: "shop", value: "car_parts" }] },
  { terms: ["concessionaria", "revenda de veiculos", "carros"], label: "Revenda de veículos", tags: [{ key: "shop", value: "car" }] },
  { terms: ["lava jato", "lava rapido", "estetica automotiva"], label: "Lava-rápido", tags: [{ key: "amenity", value: "car_wash" }] },
  { terms: ["hotel", "hoteis"], label: "Hotel", tags: [{ key: "tourism", value: "hotel" }, { key: "tourism", value: "motel" }] },
  { terms: ["pousada", "hostel", "hospedagem"], label: "Pousada", tags: [{ key: "tourism", value: "guest_house" }, { key: "tourism", value: "hostel" }] },
  { terms: ["otica", "oculos"], label: "Ótica", tags: [{ key: "shop", value: "optician" }] },
  { terms: ["floricultura", "flores"], label: "Floricultura", tags: [{ key: "shop", value: "florist" }] },
  { terms: ["papelaria", "livraria"], label: "Papelaria/Livraria", tags: [{ key: "shop", value: "stationery" }, { key: "shop", value: "books" }] },
  { terms: ["loja de roupas", "roupas", "moda", "boutique", "vestuario"], label: "Loja de roupas", tags: [{ key: "shop", value: "clothes" }, { key: "shop", value: "boutique" }] },
  { terms: ["calcados", "sapataria", "sapatos"], label: "Calçados", tags: [{ key: "shop", value: "shoes" }] },
  { terms: ["moveis", "loja de moveis", "decoracao"], label: "Móveis e decoração", tags: [{ key: "shop", value: "furniture" }, { key: "shop", value: "interior_decoration" }] },
  { terms: ["material de construcao", "materiais de construcao", "home center", "ferragens", "ferragista"], label: "Material de construção", tags: [{ key: "shop", value: "hardware" }, { key: "shop", value: "doityourself" }, { key: "shop", value: "trade" }] },
  { terms: ["joalheria", "relojoaria", "joias"], label: "Joalheria", tags: [{ key: "shop", value: "jewelry" }, { key: "shop", value: "watches" }] },
  { terms: ["eletronicos", "celulares", "assistencia tecnica", "informatica"], label: "Eletrônicos e informática", tags: [{ key: "shop", value: "electronics" }, { key: "shop", value: "mobile_phone" }, { key: "shop", value: "computer" }] },
  { terms: ["lavanderia"], label: "Lavanderia", tags: [{ key: "shop", value: "laundry" }, { key: "shop", value: "dry_cleaning" }] },
  { terms: ["grafica", "copiadora", "impressao"], label: "Gráfica", tags: [{ key: "shop", value: "copyshop" }, { key: "craft", value: "printer" }] },
  { terms: ["coworking"], label: "Coworking", tags: [{ key: "amenity", value: "coworking_space" }, { key: "office", value: "coworking" }] },
  { terms: ["posto", "posto de gasolina", "combustivel"], label: "Posto de combustível", tags: [{ key: "amenity", value: "fuel" }] },
  { terms: ["banco", "agencia bancaria"], label: "Banco", tags: [{ key: "amenity", value: "bank" }] },
  { terms: ["marcenaria", "marceneiro"], label: "Marcenaria", tags: [{ key: "craft", value: "carpenter" }] },
  { terms: ["eletricista"], label: "Eletricista", tags: [{ key: "craft", value: "electrician" }] },
  { terms: ["encanador", "hidraulica"], label: "Encanador", tags: [{ key: "craft", value: "plumber" }] },
  { terms: ["fotografo", "fotografia", "estudio fotografico"], label: "Fotografia", tags: [{ key: "craft", value: "photographer" }, { key: "shop", value: "photo" }] },
  { terms: ["tatuagem", "tattoo", "estudio de tatuagem"], label: "Estúdio de tatuagem", tags: [{ key: "shop", value: "tattoo" }] },
  { terms: ["agencia de marketing", "marketing", "publicidade", "agencia"], label: "Marketing e publicidade", tags: [{ key: "office", value: "advertising_agency" }, { key: "office", value: "company", extra: '["name"~"marketing|publicidade|digital",i]' }] },
];

export type OsmQueryPlan = { label: string; tags: TagFilter[]; matchedTerm: string | null };

/** Encontra o nicho mais próximo; sem correspondência, cai na busca por nome. */
export function planOsmQuery(keyword: string): OsmQueryPlan {
  const k = fold(keyword);
  let best: { entry: (typeof MAP)[number]; term: string } | null = null;
  for (const entry of MAP) {
    for (const term of entry.terms) {
      const t = fold(term);
      if (k === t || k.startsWith(`${t} `) || k.endsWith(` ${t}`) || k.includes(` ${t} `) || (t.length >= 5 && k.includes(t))) {
        if (!best || t.length > fold(best.term).length) best = { entry, term };
      }
    }
  }
  if (best) return { label: best.entry.label, tags: best.entry.tags, matchedTerm: best.term };
  return { label: keyword, tags: [], matchedTerm: null };
}

/** Rótulo legível da categoria a partir das etiquetas OSM do elemento. */
export function osmCategoryLabel(tags: Record<string, string>): string | null {
  for (const entry of MAP) {
    if (entry.tags.some((t) => tags[t.key] === t.value)) return entry.label;
  }
  const raw = tags.shop ?? tags.amenity ?? tags.office ?? tags.craft ?? tags.healthcare ?? tags.tourism ?? tags.leisure;
  return raw ? raw.replace(/_/g, " ") : null;
}
