async function getYears(db, logger) {
  try {
    const yearsCollection = db.collection('Years')
    const years = await yearsCollection.find({}).sort({ year: -1 }).toArray()

    return {
      success: true,
      count: years.length,
      years: years.map((doc) => ({
        id: doc.yearID,
        year: doc.year,
        yearIsLive: doc.yearIsLive
      }))
    }
  } catch (error) {
    logger.error(error, 'Failed to fetch years')
    throw error
  }
}

export { getYears }
