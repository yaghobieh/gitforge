<<<<<<< HEAD
import { Request, Response, NextFunction } from 'express';
import { UserService } from './services/UserService';
import { Logger } from './utils/Logger';
=======
import { Request, Response, NextFunction, Router } from 'express';
import { UserService } from './services/UserService';
import { AuthService } from './services/AuthService';
import { Logger, LogLevel } from './utils/Logger';
import { validateRequest } from './middleware/validation';
>>>>>>> feature-branch

<<<<<<< HEAD
const API_VERSION = 'v1';
const MAX_RETRIES = 3;
const TIMEOUT_MS = 5000;
=======
const API_VERSION = 'v2';
const MAX_RETRIES = 5;
const TIMEOUT_MS = 10000;
const CACHE_TTL = 3600;
>>>>>>> feature-branch

<<<<<<< HEAD
interface UserData {
    id: string;
    name: string;
    email: string;
}
=======
interface UserData {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'user' | 'guest';
    createdAt: Date;
    lastLogin?: Date;
}
>>>>>>> feature-branch

<<<<<<< HEAD
class UserController {
    private userService: UserService;
    private logger: Logger;

    constructor() {
        this.userService = new UserService();
        this.logger = new Logger('UserController');
    }

    async getUser(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        this.logger.info(`Fetching user ${id}`);
        
        const user = await this.userService.findById(id);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json(user);
    }

    async createUser(req: Request, res: Response): Promise<void> {
        const userData = req.body;
        const user = await this.userService.create(userData);
        res.status(201).json(user);
    }
}
=======
class UserController {
    private userService: UserService;
    private authService: AuthService;
    private logger: Logger;

    constructor() {
        this.userService = new UserService();
        this.authService = new AuthService();
        this.logger = new Logger('UserController', LogLevel.DEBUG);
    }

    async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            this.logger.info(`Fetching user ${id}`);
            
            const user = await this.userService.findById(id);
            if (!user) {
                res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
                return;
            }
            
            const sanitizedUser = this.sanitizeUser(user);
            res.json({ data: sanitizedUser, success: true });
        } catch (error) {
            next(error);
        }
    }

    async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userData = req.body;
            const existingUser = await this.userService.findByEmail(userData.email);
            
            if (existingUser) {
                res.status(409).json({ error: 'User already exists', code: 'DUPLICATE_USER' });
                return;
            }
            
            const hashedPassword = await this.authService.hashPassword(userData.password);
            const user = await this.userService.create({ ...userData, password: hashedPassword });
            
            this.logger.info(`Created user ${user.id}`);
            res.status(201).json({ data: user, success: true });
        } catch (error) {
            next(error);
        }
    }

    async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const updates = req.body;
            
            const user = await this.userService.update(id, updates);
            res.json({ data: user, success: true });
        } catch (error) {
            next(error);
        }
    }

    private sanitizeUser(user: UserData): Partial<UserData> {
        const { id, name, email, role } = user;
        return { id, name, email, role };
    }
}
>>>>>>> feature-branch

<<<<<<< HEAD
function setupRoutes(app: any): void {
    const controller = new UserController();
    app.get('/users/:id', controller.getUser.bind(controller));
    app.post('/users', controller.createUser.bind(controller));
}
=======
function setupRoutes(router: Router): Router {
    const controller = new UserController();
    
    router.get('/users/:id', validateRequest('getUser'), controller.getUser.bind(controller));
    router.post('/users', validateRequest('createUser'), controller.createUser.bind(controller));
    router.put('/users/:id', validateRequest('updateUser'), controller.updateUser.bind(controller));
    router.delete('/users/:id', validateRequest('deleteUser'), controller.deleteUser.bind(controller));
    
    return router;
}
>>>>>>> feature-branch

<<<<<<< HEAD
export { UserController, setupRoutes, UserData };
=======
export { 
    UserController, 
    setupRoutes, 
    UserData,
    API_VERSION,
    MAX_RETRIES,
    TIMEOUT_MS,
    CACHE_TTL
};
>>>>>>> feature-branch
