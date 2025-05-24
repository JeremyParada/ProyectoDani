const jwt = require('jsonwebtoken');

module.exports = async (req, res, next) => {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(401).send({ message: 'No token provided.' });
    }

    try {
        const decoded = await jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).send({ message: 'Unauthorized!' });
    }
};