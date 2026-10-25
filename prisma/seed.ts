import "dotenv/config";
import { PrismaClient, type ResourceType } from "@prisma/client";
import { pathToFileURL } from "node:url";

/** Idempotent demo catalog. Never creates passwords, real contacts, reviews, or fake customer records. */
export async function seedCatalog(client: PrismaClient) {
  await client.studioSettings.upsert({
    where: { id: "studio" },
    update: {},
    create: {
      id: "studio",
      rulesVersion: "demo-1",
      rulesText:
        "Демонстрационные условия для проверки владельцем. Предоплата — 30%, удержание времени — 15 минут. До начала съёмки можно отменить заказ или перенести его на свободное время. Возвраты согласуются сотрудником и записываются отдельной операцией. Это тестовые настройки; перед реальным запуском студия должна утвердить правила аренды и возврата.",
    },
  });
  async function resource(
    id: string,
    name: string,
    type: ResourceType,
    quantity = 1,
  ) {
    await client.resource.upsert({
      where: { id },
      update: {},
      create: { id, name, type },
    });
    for (let serial = 1; serial <= quantity; serial++) {
      await client.resourceUnit.upsert({
        where: { resourceId_serial: { resourceId: id, serial } },
        update: {},
        create: { id: `${id}-unit-${serial}`, resourceId: id, serial },
      });
    }
  }
  for (const room of [
    { id: "room-light", name: "Светлый зал (демо)", capacity: 10 },
    { id: "room-loft", name: "Лофт (демо)", capacity: 12 },
    { id: "room-cyclorama", name: "Циклорама (демо)", capacity: 8 },
    { id: "room-podcast", name: "Подкаст-комната (демо)", capacity: 4 },
  ]) {
    await resource(`${room.id}-resource`, room.name, "ROOM");
    await client.room.upsert({
      where: { id: room.id },
      update: {},
      create: { ...room, resourceId: `${room.id}-resource` },
    });
  }
  const locations = [
    {
      id: "daylight",
      slug: "daylight",
      name: "Daylight",
      roomId: "room-light",
      area: 64,
      capacity: 10,
      hourlyPriceMinor: 1_200_000,
      tags: ["Фото", "Личный контент", "Реклама"],
      description:
        "Естественный свет, мягкие фактуры и свободное пространство. Зал для портретов, предметной съёмки и личного контента.",
      descriptionKk:
        "Табиғи жарық, жұмсақ фактуралар және еркін кеңістік. Портрет пен жеке контентке арналған зал.",
    },
    {
      id: "loft",
      slug: "loft",
      name: "Loft",
      roomId: "room-loft",
      area: 82,
      capacity: 12,
      hourlyPriceMinor: 1_500_000,
      tags: ["Фото", "Видео", "Реклама"],
      description:
        "Тёплый кирпич, выразительные тени и характерные детали для рекламных съёмок и видео.",
      descriptionKk:
        "Жарнама мен бейнеге арналған жылы кірпіш, айқын көлеңкелер және ерекше бөлшектер.",
    },
    {
      id: "cyclorama",
      slug: "cyclorama",
      name: "Cyclorama",
      roomId: "room-cyclorama",
      area: 56,
      capacity: 8,
      hourlyPriceMinor: 1_800_000,
      tags: ["Фото", "Видео", "Реклама"],
      description:
        "Белая циклорама и управляемый свет. Чистая основа для каталога, моды и работы с цветом.",
      descriptionKk:
        "Ақ циклорама және басқарылатын жарық. Каталог, сән және түспен жұмыс істеуге арналған таза негіз.",
    },
    {
      id: "podcast",
      slug: "podcast",
      name: "Podcast",
      roomId: "room-podcast",
      area: 28,
      capacity: 4,
      hourlyPriceMinor: 1_000_000,
      tags: ["Подкаст", "Видео", "Личный контент"],
      description:
        "Камерное пространство для интервью, разговоров и записей подкаста. Звук и оборудование выбираются отдельно.",
      descriptionKk:
        "Сұхбаттар, әңгімелер және подкаст жазуға арналған жайлы кеңістік. Дыбыс пен жабдық бөлек таңдалады.",
    },
    {
      id: "seasonal",
      slug: "seasonal",
      name: "Seasonal",
      roomId: "room-light",
      area: 64,
      capacity: 8,
      hourlyPriceMinor: 1_400_000,
      tags: ["Фото", "Reels/TikTok", "Личный контент"],
      description:
        "Сезонное оформление светлого зала. В демонстрационной планировке делит помещение с Daylight — доступность общая.",
      descriptionKk:
        "Жарық залдың маусымдық безендірілуі. Демо-жоспарда Daylight-пен бір бөлмені пайдаланады — қолжетімділік ортақ.",
    },
  ];
  for (const location of locations) {
    await client.location.upsert({
      where: { id: location.id },
      update: {},
      create: { ...location, image: `/images/${location.id}.svg` },
    });
    await client.decorVersion.upsert({
      where: { id: `${location.id}-v1` },
      update: {},
      create: {
        id: `${location.id}-v1`,
        locationId: location.id,
        name:
          location.id === "seasonal"
            ? "Тёплый сезон · демо"
            : "Базовое оформление · демо",
        image: `/images/${location.id}.svg`,
        validFrom: new Date("2020-01-01T00:00:00Z"),
      },
    });
  }
  for (const specialist of [
    {
      id: "photographer",
      name: "Фотограф · демо",
      specialty: "Портрет и коммерческая фотография",
      hourlyPriceMinor: 2_000_000,
    },
    {
      id: "videographer",
      name: "Видеограф · демо",
      specialty: "Видео и реклама",
      hourlyPriceMinor: 2_500_000,
    },
    {
      id: "mobile-creator",
      name: "Мобилограф · демо",
      specialty: "Reels и короткие видео",
      hourlyPriceMinor: 1_500_000,
    },
  ]) {
    await resource(`${specialist.id}-resource`, specialist.name, "SPECIALIST");
    await client.specialist.upsert({
      where: { id: specialist.id },
      update: {},
      create: { ...specialist, resourceId: `${specialist.id}-resource` },
    });
  }
  for (const service of [
    {
      id: "retouch",
      name: "Обработка 10 фотографий",
      description:
        "Демо-пакет обработки после съёмки; срок согласуется в контент-проекте.",
      priceMinor: 800_000,
      production: true,
    },
    {
      id: "editing",
      name: "Монтаж короткого видео",
      description: "Демо-пакет монтажа ролика до 60 секунд после съёмки.",
      priceMinor: 1_200_000,
      production: true,
    },
    {
      id: "props",
      name: "Набор реквизита",
      description: "Демонстрационная услуга подготовки базового реквизита.",
      priceMinor: 300_000,
      production: false,
    },
  ])
    await client.service.upsert({
      where: { id: service.id },
      update: {},
      create: service,
    });
  for (const equipment of [
    {
      id: "light",
      name: "Постоянный LED-свет",
      priceMinor: 200_000,
      quantity: 2,
    },
    {
      id: "microphone",
      name: "Студийный микрофон",
      priceMinor: 150_000,
      quantity: 2,
    },
    {
      id: "camera",
      name: "Камера для видео",
      priceMinor: 500_000,
      quantity: 1,
    },
  ]) {
    await resource(
      `${equipment.id}-resource`,
      `${equipment.name} · демо`,
      "EQUIPMENT",
      equipment.quantity,
    );
    await client.equipment.upsert({
      where: { id: equipment.id },
      update: {},
      create: {
        id: equipment.id,
        name: equipment.name,
        priceMinor: equipment.priceMinor,
        resourceId: `${equipment.id}-resource`,
      },
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const client = new PrismaClient();
  seedCatalog(client)
    .then(() =>
      console.log(
        "Demo catalog seeded: five locations in four rooms. No user passwords were created.",
      ),
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Seed failed");
      process.exitCode = 1;
    })
    .finally(() => client.$disconnect());
}
